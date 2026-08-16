import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { sitesMapApi } from "../api/resources";
import type { SiteMapData } from "../api/types";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import StatCard from "../components/ui/StatCard";
import { useAuth } from "../context/AuthContext";
import { PERMS, hasPerm } from "../utils/permissions";

import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default function SitesMap() {
  const { user } = useAuth();
  const canRegeocode = hasPerm(user, PERMS.changeSite);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [data, setData] = useState<SiteMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [regeocoding, setRegeocoding] = useState(false);

  function reload() {
    setLoading(true);
    sitesMapApi.mapData().then(setData).finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    if (!data || !mapContainerRef.current) return;

    if (!mapRef.current) {
      mapRef.current = L.map(mapContainerRef.current).setView([-15.78, -47.93], 4);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(mapRef.current);
    }

    const map = mapRef.current;
    const layerGroup = L.layerGroup().addTo(map);

    data.points.forEach((point) => {
      const projectsHtml = point.projects.length
        ? `<ul style="margin:4px 0 0;padding-left:16px;">${point.projects
            .map(
              (p) =>
                `<li>${escapeHtml(p.code)} — ${escapeHtml(p.name)}${p.client ? ` (${escapeHtml(p.client)})` : ""}</li>`
            )
            .join("")}</ul>`
        : `<p style="margin:4px 0 0;color:#94a3b8;">Nenhum projeto ativo</p>`;
      const popupHtml = `
        <strong>${escapeHtml(point.name)}</strong><br/>
        ${point.client ? `<span style="color:#526174;">${escapeHtml(point.client)}</span><br/>` : ""}
        <span style="color:#526174;font-size:12px;">${escapeHtml(point.address)}</span>
        ${projectsHtml}
      `;
      L.marker([point.lat, point.lng]).addTo(layerGroup).bindPopup(popupHtml);
    });

    if (data.points.length) {
      const bounds = L.latLngBounds(data.points.map((p) => [p.lat, p.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [32, 32] });
    }

    return () => {
      layerGroup.remove();
    };
  }, [data]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  async function handleRegeocodeAll() {
    if (!confirm("Reprocessar a geocodificação de todos os sites ativos sem coordenadas manuais? Isso pode levar alguns segundos.")) return;
    setRegeocoding(true);
    try {
      const result = await sitesMapApi.regeocodeBulk();
      let message = `${result.updated} site(s) geocodificado(s) com sucesso.`;
      if (result.failed) message += ` ${result.failed} não foram encontrados pelo serviço de geocodificação.`;
      if (result.skipped_manual) message += ` ${result.skipped_manual} ignorado(s) por ter coordenadas manuais.`;
      alert(message);
      reload();
    } finally {
      setRegeocoding(false);
    }
  }

  return (
    <div>
      <Link to="/cadastros" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--text-muted)", textDecoration: "none", fontSize: 13, marginBottom: 12 }}>
        <Icon name="arrow_back" style={{ fontSize: 16 }} />
        Voltar para Cadastros
      </Link>

      <PageHeader
        eyebrow="Sites"
        title="Mapa de Sites"
        subtitle="Sites ativos com coordenadas e seus projetos em andamento."
        actions={
          canRegeocode ? (
            <button className="btn btn-outline" onClick={handleRegeocodeAll} disabled={regeocoding}>
              <Icon name="my_location" style={{ fontSize: 16 }} />
              {regeocoding ? "Processando..." : "Reprocessar geocodificação"}
            </button>
          ) : undefined
        }
      />

      {data && (
        <div className="stat-grid">
          <StatCard label="Sites no mapa" value={data.points_count} icon="location_on" tone="blue" />
          <StatCard label="Sem coordenadas" value={data.without_coords} hint="ativos, ainda não geocodificados" icon="location_off" tone="amber" />
        </div>
      )}

      {loading && !data && <p style={{ color: "var(--text-muted)" }}>Carregando...</p>}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div ref={mapContainerRef} style={{ height: 560, width: "100%" }} />
      </div>
    </div>
  );
}
