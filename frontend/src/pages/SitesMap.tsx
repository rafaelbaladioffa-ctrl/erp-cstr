import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { sitesMapApi } from "../api/resources";
import type { SiteMapData, SiteMapPoint } from "../api/types";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import StatCard from "../components/ui/StatCard";
import { useAuth } from "../context/AuthContext";
import { PERMS, hasPerm } from "../utils/permissions";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pinIcon(count: number): L.DivIcon {
  const hasProjects = count > 0;
  return L.divIcon({
    className: "",
    html: `
      <div style="position:relative;width:30px;height:30px;">
        <div style="width:30px;height:30px;border-radius:50%;background:${hasProjects ? "#F16023" : "#172033"};border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,0.35);"></div>
        <div style="position:absolute;top:-7px;right:-7px;min-width:19px;height:19px;border-radius:999px;background:${hasProjects ? "#F16023" : "#172033"};color:#fff;border:2px solid #fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 3px;">${count}</div>
      </div>
    `,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -18],
  });
}

export default function SitesMap() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canRegeocode = hasPerm(user, PERMS.changeSite);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [data, setData] = useState<SiteMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [regeocoding, setRegeocoding] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState<SiteMapPoint | null>(null);

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
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
        attribution: "Tiles &copy; Esri",
        maxZoom: 19,
      }).addTo(mapRef.current);
    }

    const map = mapRef.current;
    const layerGroup = L.layerGroup().addTo(map);

    data.points.forEach((point) => {
      const count = point.projects.length;
      const marker = L.marker([point.lat, point.lng], { icon: pinIcon(count) }).addTo(layerGroup);
      const popupHtml = `
        <strong>${escapeHtml(point.name)}</strong>
        <span style="background:#F16023;color:#fff;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:700;margin-left:6px;">${count} projeto(s) ativo(s)</span><br/>
        ${point.client ? `<span style="color:#526174;">${escapeHtml(point.client)}</span><br/>` : ""}
        <span style="color:#526174;font-size:12px;">${escapeHtml(point.address)}</span>
      `;
      marker.bindPopup(popupHtml);
      marker.on("click", () => setSelectedPoint(point));
    });

    if (data.points.length) {
      const bounds = L.latLngBounds(data.points.map((p) => [p.lat, p.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [32, 32] });
      if (data.points.length === 1) map.setZoom(14);
    }

    return () => {
      layerGroup.remove();
    };
  }, [data]);

  useEffect(() => {
    if (!mapRef.current) return;
    setTimeout(() => mapRef.current?.invalidateSize(), 210);
  }, [selectedPoint]);

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

      <div className="card" style={{ padding: 0, overflow: "hidden", position: "relative", height: 560 }}>
        <div ref={mapContainerRef} style={{ height: "100%", width: "100%" }} />

        {selectedPoint && (
          <div
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              width: 320,
              maxWidth: "100%",
              background: "#fff",
              borderLeft: "1px solid #DDE3EA",
              boxShadow: "-4px 0 12px rgba(0,0,0,0.06)",
              overflowY: "auto",
              zIndex: 5,
            }}
          >
            <div style={{ padding: "16px 18px", borderBottom: "1px solid #DDE3EA", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h2 style={{ fontSize: 15, color: "#172033", margin: "0 0 4px" }}>{selectedPoint.name}</h2>
                <p style={{ fontSize: 12, color: "#526174", margin: 0 }}>
                  {selectedPoint.projects.length} projeto(s) ativo(s) neste site
                </p>
              </div>
              <button
                onClick={() => setSelectedPoint(null)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#526174", lineHeight: 1 }}
              >
                &times;
              </button>
            </div>
            <div>
              {selectedPoint.projects.length === 0 ? (
                <div style={{ padding: 18, fontSize: 13, color: "#526174" }}>Nenhum projeto ativo neste site no momento.</div>
              ) : (
                selectedPoint.projects.map((project) => (
                  <a
                    key={project.id}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/projetos/${project.id}`);
                    }}
                    href={`/projetos/${project.id}`}
                    style={{ display: "block", padding: "12px 18px", borderBottom: "1px solid #F0F2F5", textDecoration: "none", cursor: "pointer" }}
                  >
                    <div style={{ fontSize: 11, color: "#F16023", fontWeight: 700 }}>{project.code}</div>
                    <div style={{ fontSize: 13.5, color: "#172033", fontWeight: 600, margin: "2px 0" }}>{project.name}</div>
                    {project.client && <div style={{ fontSize: 12, color: "#526174" }}>{project.client}</div>}
                  </a>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
