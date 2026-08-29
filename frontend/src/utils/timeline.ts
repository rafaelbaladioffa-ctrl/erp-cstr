import type { PairPartner, TimelineBlock } from "../api/types";

export const PRESENCE_COLOR: Record<string, string> = {
  not_started: "var(--text-faint)",
  available: "var(--green)",
  in_progress: "var(--amber)",
  lunch: "var(--purple)",
  personal: "var(--blue)",
  site_blocked: "var(--red)",
  awaiting_release: "var(--orange)",
  off_duty: "var(--text-faint)",
};

export const BUSY_COLOR: Record<string, string> = {
  in_progress: "var(--amber)",
  paused: "var(--orange)",
};

export const DONE_COLOR = "var(--blue)";

export const PRESENCE_LABEL: Record<string, string> = {
  not_started: "Não chegou",
  available: "Disponível",
  in_progress: "Em Execução",
  lunch: "Horário de Almoço",
  personal: "Particular",
  site_blocked: "Sem Acesso ao Site",
  awaiting_release: "Aguardando Liberações",
  off_duty: "Fim de Expediente",
};

// Status que "explicam" uma pausa — se o técnico pausou uma tarefa e trocou
// pra um desses, a barra da pausa reflete o motivo em vez do genérico "Em pausa".
export const AWAY_STATUSES = ["lunch", "personal", "site_blocked", "awaiting_release"];

export const WINDOW_START_HOUR = 7;
export const WINDOW_END_HOUR = 19;
export const WINDOW_MINUTES = (WINDOW_END_HOUR - WINDOW_START_HOUR) * 60;
export const HOURS = Array.from({ length: WINDOW_END_HOUR - WINDOW_START_HOUR + 1 }, (_, i) => WINDOW_START_HOUR + i);

export function pct(date: Date, base: Date) {
  const dayStart = new Date(base);
  dayStart.setHours(WINDOW_START_HOUR, 0, 0, 0);
  const minutes = (date.getTime() - dayStart.getTime()) / 60000;
  return Math.max(0, Math.min(100, (minutes / WINDOW_MINUTES) * 100));
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

export interface Segment {
  color: string;
  label: string;
  start: Date;
  end: Date | null; // null = ainda aberto (vai até "agora")
  live: boolean;
}

export interface StatusEventLike {
  status: string;
  status_display: string;
  changed_at: string;
}

interface Interval {
  start: number;
  end: number;
}

/** Recorta `base` removendo os trechos cobertos por qualquer intervalo em
 * `cuts` — usado pra tirar das barras de presença o tempo que já é coberto
 * por uma barra de tarefa (concluída ou aberta), pra não desenhar duas
 * barras sobrepostas no mesmo horário. */
function subtractIntervals(base: Interval, cuts: Interval[]): Interval[] {
  let pieces: Interval[] = [base];
  for (const cut of cuts) {
    const next: Interval[] = [];
    for (const p of pieces) {
      if (cut.end <= p.start || cut.start >= p.end) {
        next.push(p);
        continue;
      }
      if (cut.start > p.start) next.push({ start: p.start, end: cut.start });
      if (cut.end < p.end) next.push({ start: cut.end, end: p.end });
    }
    pieces = next;
  }
  // descarta sobras menores que 1min (ruído de arredondamento)
  return pieces.filter((p) => p.end - p.start >= 60000);
}

/** Monta as barras do dia de um técnico combinando três fontes: as tarefas
 * já CONCLUÍDAS naquele dia, as tarefas ABERTAS agora (executando/pausada —
 * pode ter mais de uma, ver stacking em assignLanes), e o HISTÓRICO de
 * trocas de status de presença (`statusEvents`, um registro por troca) —
 * cada troca vira sua própria barra, recortada nos trechos que já são
 * cobertos por uma tarefa naquele intervalo. Isso substitui a aproximação
 * antiga (só a barra do status ATUAL) por uma timeline fiel a cada mudança
 * que realmente aconteceu no dia.
 *
 * `isLive`: true = timeline ao vivo (barras abertas vão até "agora" de
 * verdade e pulsam); false = dia fechado no histórico (barras abertas —
 * caso raro de tarefa nunca finalizada — só vão até o `now` passado). */
export function buildTechSegments(
  blocks: TimelineBlock[],
  statusEvents: StatusEventLike[],
  now: Date,
  isLive: boolean
): Segment[] {
  const nowMs = now.getTime();
  const segments: Segment[] = [];
  const taskIntervals: Interval[] = [];

  const sortedEvents = [...statusEvents].sort(
    (a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime()
  );
  const lastStatus = sortedEvents.length > 0 ? sortedEvents[sortedEvents.length - 1].status : null;

  for (const b of blocks) {
    if (b.status === "completed" && b.actual_start && b.actual_end) {
      const start = new Date(b.actual_start);
      const end = new Date(b.actual_end);
      segments.push({ color: DONE_COLOR, label: b.name, start, end, live: false });
      taskIntervals.push({ start: start.getTime(), end: end.getTime() });
    } else if ((b.status === "in_progress" || b.status === "paused") && b.actual_start) {
      const start = new Date(b.actual_start);
      taskIntervals.push({ start: start.getTime(), end: nowMs });
      if (b.status === "paused") {
        if (lastStatus && AWAY_STATUSES.includes(lastStatus)) {
          segments.push({
            color: PRESENCE_COLOR[lastStatus],
            label: `${PRESENCE_LABEL[lastStatus]} · ${b.name}`,
            start,
            end: isLive ? null : now,
            live: false,
          });
        } else {
          segments.push({ color: BUSY_COLOR.paused, label: `Em pausa · ${b.name}`, start, end: isLive ? null : now, live: false });
        }
      } else {
        segments.push({ color: BUSY_COLOR.in_progress, label: b.name, start, end: isLive ? null : now, live: isLive });
      }
    }
  }

  for (let i = 0; i < sortedEvents.length; i++) {
    const ev = sortedEvents[i];
    if (ev.status === "not_started") continue;
    const startMs = new Date(ev.changed_at).getTime();
    const endMs = i + 1 < sortedEvents.length ? new Date(sortedEvents[i + 1].changed_at).getTime() : nowMs;
    if (endMs <= startMs) continue;
    const isLastEvent = i === sortedEvents.length - 1;
    const pieces = subtractIntervals({ start: startMs, end: endMs }, taskIntervals);
    for (const piece of pieces) {
      const isOpenTail = isLastEvent && piece.end === endMs;
      segments.push({
        color: PRESENCE_COLOR[ev.status] || "var(--text-faint)",
        label: PRESENCE_LABEL[ev.status] || ev.status_display,
        start: new Date(piece.start),
        end: isOpenTail && isLive ? null : new Date(piece.end),
        live: false,
      });
    }
  }

  segments.sort((a, b) => a.start.getTime() - b.start.getTime());
  return segments;
}

export interface LanedSegment {
  segment: Segment;
  lane: number;
  laneCount: number;
}

/** Empilha os segmentos em ordem cronológica, um por linha — cada tarefa/
 * status ganha sua própria linha à medida que o dia avança, em vez de
 * amontoar vários num só lugar (o que ficava ilegível quando o técnico tinha
 * várias tarefas curtas seguidas: virava uma sequência de bolinhas coladas
 * numa linha só). Sem tentativa de reaproveitar linha entre segmentos que
 * não se sobrepõem — cada barra tem seu próprio espaço vertical. */
export function assignLanes(segments: Segment[]): LanedSegment[] {
  const sorted = [...segments].sort((a, b) => a.start.getTime() - b.start.getTime());
  const laneCount = Math.max(1, sorted.length);
  return sorted.map((segment, lane) => ({ segment, lane, laneCount }));
}

interface Paired {
  id: number;
  pair_partner: PairPartner | null;
}

export interface PairGroup<T extends Paired> {
  primary: T;
  partner: T | null;
}

/** Agrupa a lista de técnicos em duplas fixas (ver CollaboratorPair no
 * backend) — cada item aparece uma única vez, como `primary` sozinho (sem
 * dupla) ou como `{primary, partner}`. A ordem de entrada é preservada
 * (só pula o parceiro quando ele já apareceu antes na lista). */
export function groupByPair<T extends Paired>(items: T[]): PairGroup<T>[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<number>();
  const groups: PairGroup<T>[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const partner = item.pair_partner ? byId.get(item.pair_partner.id) || null : null;
    if (partner) seen.add(partner.id);
    groups.push({ primary: item, partner });
  }
  return groups;
}

/** Reordena `rows` (qualquer lista com `tech: Paired`) pra que duplas
 * fiquem em linhas adjacentes — usado na timeline, onde já existe um array
 * de linhas construído (com segments/lanes calculados) e só a ORDEM precisa
 * mudar, não os dados. */
export function reorderRowsByPair<R extends { tech: Paired }>(rows: R[]): R[] {
  const groups = groupByPair(rows.map((r) => r.tech));
  const byTechId = new Map(rows.map((r) => [r.tech.id, r]));
  const ordered: R[] = [];
  for (const g of groups) {
    const primaryRow = byTechId.get(g.primary.id);
    if (primaryRow) ordered.push(primaryRow);
    if (g.partner) {
      const partnerRow = byTechId.get(g.partner.id);
      if (partnerRow) ordered.push(partnerRow);
    }
  }
  return ordered;
}

/** Classe CSS pra dar o visual de "linhas coladas" às duas linhas de uma
 * dupla na timeline (fundo compartilhado, sem borda entre elas) — chamar
 * pra cada índice da lista JÁ reordenada por reorderRowsByPair. */
export function pairRowClass<R extends { tech: Paired }>(rows: R[], index: number): string {
  const row = rows[index];
  const prev = rows[index - 1];
  const next = rows[index + 1];
  const pairedWithPrev = !!prev && row.tech.pair_partner?.id === prev.tech.id;
  const pairedWithNext = !!next && row.tech.pair_partner?.id === next.tech.id;
  if (!pairedWithPrev && !pairedWithNext) return "";
  return `tl-row-pair${pairedWithPrev ? " tl-row-pair-second" : " tl-row-pair-first"}`;
}
