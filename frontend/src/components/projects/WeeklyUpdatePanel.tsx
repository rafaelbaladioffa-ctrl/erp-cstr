import { useState } from "react";
import { projectUpdatesApi } from "../../api/resources";
import type { Project, UserOption } from "../../api/types";
import DateRangeCalendar, { type DateRange } from "../ui/DateRangeCalendar";
import EmailLanguageSelect, { defaultEmailLanguage, type EmailLanguage } from "../ui/EmailLanguageSelect";
import { useI18n, usePageText } from "../../i18n";
import { addDaysIso, brazilTodayIso } from "../../utils/date";

const TEXT = {
  "pt-BR": {
    title: "Update Semanal",
    info: "Envia um único e-mail com um bloco para cada projeto selecionado. Para cada projeto é usada a atualização mais recente do período (ou uma nova é gerada). Os responsáveis do cliente recebem apenas os projetos do próprio cliente.",
    period: "Semana",
    projects: "Projetos",
    search: "Buscar projeto ou PO...",
    selectAll: "Marcar todos os filtrados",
    clear: "Limpar",
    selected: "selecionado(s)",
    systemUsers: "Usuários do sistema (recebem todos os projetos)",
    extraEmails: "E-mails avulsos (recebem todos os projetos)",
    extraEmailsPlaceholder: "Separe por vírgula ou uma linha por e-mail",
    send: "Enviar Update Semanal",
    sending: "Enviando...",
    sentResult: "e-mail(s) enviado(s) com",
    projectsWord: "projeto(s).",
    noEmail: "Sem e-mail:",
    errorSend: "Não foi possível enviar o Update Semanal.",
  },
  "en-US": {
    title: "Weekly Update",
    info: "Sends a single e-mail with one block per selected project. For each project the most recent update in the period is used (or a new one is generated). Client contacts only receive their own client's projects.",
    period: "Week",
    projects: "Projects",
    search: "Search project or PO...",
    selectAll: "Select all filtered",
    clear: "Clear",
    selected: "selected",
    systemUsers: "System users (receive all projects)",
    extraEmails: "Individual e-mails (receive all projects)",
    extraEmailsPlaceholder: "Separate by comma or one e-mail per line",
    send: "Send Weekly Update",
    sending: "Sending...",
    sentResult: "e-mail(s) sent with",
    projectsWord: "project(s).",
    noEmail: "No e-mail:",
    errorSend: "Could not send the Weekly Update.",
  },
  "es-ES": {
    title: "Update Semanal",
    info: "Envía un único correo con un bloque por cada proyecto seleccionado. Para cada proyecto se usa la actualización más reciente del período (o se genera una nueva). Los responsables del cliente solo reciben los proyectos de su propio cliente.",
    period: "Semana",
    projects: "Proyectos",
    search: "Buscar proyecto o PO...",
    selectAll: "Marcar todos los filtrados",
    clear: "Limpiar",
    selected: "seleccionado(s)",
    systemUsers: "Usuarios del sistema (reciben todos los proyectos)",
    extraEmails: "Correos individuales (reciben todos los proyectos)",
    extraEmailsPlaceholder: "Separe por coma o un correo por línea",
    send: "Enviar Update Semanal",
    sending: "Enviando...",
    sentResult: "correo(s) enviado(s) con",
    projectsWord: "proyecto(s).",
    noEmail: "Sin correo:",
    errorSend: "No se pudo enviar el Update Semanal.",
  },
};

export default function WeeklyUpdatePanel({ projects, userOptions }: { projects: Project[]; userOptions: UserOption[] }) {
  const p = usePageText(TEXT);
  const { locale } = useI18n();
  const today = brazilTodayIso();
  const [range, setRange] = useState<DateRange | null>({ start: addDaysIso(today, -6), end: today });
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [userIds, setUserIds] = useState<number[]>([]);
  const [emailsText, setEmailsText] = useState("");
  const [lang, setLang] = useState<EmailLanguage>(defaultEmailLanguage(locale));
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  const term = search.trim().toLowerCase();
  const filtered = projects.filter(
    (proj) =>
      !term ||
      proj.name.toLowerCase().includes(term) ||
      (proj.code || "").toLowerCase().includes(term) ||
      (proj.po || "").toLowerCase().includes(term),
  );

  function toggle(id: number) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleSend() {
    if (!range || selectedIds.length === 0) return;
    const emails = emailsText
      .split(/[,;\n]/)
      .map((e) => e.trim())
      .filter(Boolean);
    setSending(true);
    setFeedback("");
    setError("");
    try {
      const result = await projectUpdatesApi.sendWeekly({
        project_ids: selectedIds,
        start: range.start,
        end: range.end,
        user_ids: userIds,
        emails,
        language: lang,
      });
      const skipped = result.skipped.length ? ` ${p.noEmail} ${result.skipped.join(", ")}` : "";
      setFeedback(`${result.sent.length} ${p.sentResult} ${result.projects} ${p.projectsWord}${skipped}`);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || p.errorSend);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="form-card">
      <h3 style={{ margin: "0 0 6px" }}>{p.title}</h3>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>{p.info}</p>

      <label className="form-label">{p.period}</label>
      <DateRangeCalendar value={range} onChange={setRange} maxDays={31} />

      <label className="form-label">
        {p.projects} ({selectedIds.length} {p.selected})
      </label>
      <input className="input" placeholder={p.search} value={search} onChange={(e) => setSearch(e.target.value)} />
      <div style={{ display: "flex", gap: 12, margin: "6px 0", fontSize: 12 }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setSelectedIds((prev) => Array.from(new Set([...prev, ...filtered.map((x) => x.id)])))}
        >
          {p.selectAll}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setSelectedIds([])}>
          {p.clear}
        </button>
      </div>
      <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 8 }}>
        {filtered.map((proj) => (
          <label key={proj.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "3px 0", cursor: "pointer" }}>
            <input type="checkbox" checked={selectedIds.includes(proj.id)} onChange={() => toggle(proj.id)} />
            <span>
              {proj.name}
              <span style={{ color: "var(--text-muted)" }}>
                {" "}
                · {proj.code || "—"}
                {proj.po ? ` · ${proj.po}` : ""}
              </span>
            </span>
          </label>
        ))}
      </div>

      <label className="form-label">{p.systemUsers}</label>
      <select
        multiple
        className="input"
        value={userIds.map(String)}
        onChange={(e) => setUserIds(Array.from(e.target.selectedOptions).map((o) => Number(o.value)))}
        style={{ height: 90 }}
      >
        {userOptions.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} — {u.email}
          </option>
        ))}
      </select>

      <label className="form-label">{p.extraEmails}</label>
      <textarea
        className="input"
        placeholder={p.extraEmailsPlaceholder}
        value={emailsText}
        onChange={(e) => setEmailsText(e.target.value)}
        style={{ height: 60 }}
      />

      {feedback && <p style={{ fontSize: 13, color: "var(--green)", marginTop: 10, fontWeight: 600 }}>{feedback}</p>}
      {error && <p style={{ fontSize: 13, color: "var(--red)", marginTop: 10, fontWeight: 600 }}>{error}</p>}

      <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center" }}>
        <EmailLanguageSelect value={lang} onChange={setLang} />
        <button className="btn btn-primary" onClick={handleSend} disabled={sending || !range || selectedIds.length === 0}>
          {sending ? p.sending : p.send}
        </button>
      </div>
    </div>
  );
}
