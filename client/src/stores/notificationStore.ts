import {
  announcementQueue,
  type AnnouncementPhase,
  type AnnouncementQueue,
  type AnnouncementRequest,
  type AnnouncementTone,
} from "@/services/announcementQueue";

export type NotificationType =
  | "novo_chamado"
  | "finalizado"
  | "chamado_atribuido"
  | "chamado_excluido"
  | "erro_milvus"
  | "sla_aviso"
  | "sla_estourado"
  | "pesquisa_satisfacao";

interface NotificationDataBase {
  /** Permite ao produtor tornar a identidade mais específica sem mudar add(). */
  dedupeKey?: string;
}

export interface NovoChamadoData extends NotificationDataBase {
  codigo: number;
  assunto: string;
  nome_fantasia?: string;
  data_criacao?: string;
  status?: string;
  mesa_trabalho?: string;
  nome?: string;
  chatbotWaiting?: boolean;
}

export interface FinalizadoData extends NotificationDataBase {
  codigo: number;
  assunto: string;
  nome?: string;
  nome_fantasia?: string;
}

export interface ChamadoAtribuidoData extends NotificationDataBase {
  codigo: number;
  assunto: string;
  nome?: string;
  nome_fantasia?: string;
}

export interface ChamadoExcluidoData extends NotificationDataBase {
  codigo: number;
  assunto?: string;
  nome_fantasia?: string;
  nome?: string;
  operador?: string;
  /** Instante em que o painel detectou o estado no relatório do MILVUS. */
  detectadoEm?: number | string;
  /** Alias aceito para integrações que usem nomes em inglês. */
  detectedAt?: number | string;
}

export interface ErroMilvusData extends NotificationDataBase {
  status: number;
  message: string;
  endpoint?: string;
  timestamp?: string;
}

export interface SLAAvisoData extends NotificationDataBase {
  codigo: number;
  assunto: string;
  nome_fantasia?: string;
  minutos: number;
}

export interface SLAEstouradoData extends NotificationDataBase {
  codigo: number;
  assunto: string;
  nome_fantasia?: string;
}

export interface PesquisaSatisfacaoData extends NotificationDataBase {
  ticket: string;
  razao_social?: string;
  operador?: string;
  nota?: string;
  contato?: string;
  descricao_avaliacao?: string;
  data_avaliacao?: string;
}

export type NotificationData =
  | NovoChamadoData
  | FinalizadoData
  | ChamadoAtribuidoData
  | ChamadoExcluidoData
  | ErroMilvusData
  | SLAAvisoData
  | SLAEstouradoData
  | PesquisaSatisfacaoData;

export interface AppNotification {
  id: string;
  type: NotificationType;
  data: NotificationData;
  createdAt: number;
  duration: number;
  dedupeKey: string;
  announcementText: string;
  phase: AnnouncementPhase;
  detectedAt?: number;
}

type NotificationListener = (notifications: AppNotification[]) => void;

interface AnnouncementQueuePort {
  enqueue(request: AnnouncementRequest): boolean;
  cancel(id: string, reason?: string): boolean;
}

const MINIMUM_CARD_MS = 6_000;
const DEFAULT_CARD_MS = MINIMUM_CARD_MS;

const cleanSpeechValue = (value: unknown, fallback: string): string => {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || fallback;
};

const normalizeOperatorName = (value: string): string =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");

const SPECIAL_SPOKEN_OPERATOR_NAMES: Readonly<Record<string, string>> = {
  celio: "Flamenguista Dom Célio Carvalho",
  "celio carvalho": "Flamenguista Dom Célio Carvalho",
  "dom senhor celio carvalho": "Flamenguista Dom Célio Carvalho",
  abraao: "Flamenguista Dom Abraão Lima",
  "abraao lima": "Flamenguista Dom Abraão Lima",
  "dom abraao lima (idoso carismatico)": "Flamenguista Dom Abraão Lima",
  victor: "Alvinegro Dom Victor Brandão",
  "victor brandao": "Alvinegro Dom Victor Brandão",
  alves: "Flamenguista Dom Alves",
  "carlos levi": "Palestrino Dom Carlos Levi",
  bruno: "Flamenguista Dom Bruno",
  moraes: "Flamenguista Dom Moraes",
  "paulo henrique": "Flamenguista Dom Paulo Henrique",
  andre: "Brasileiro Dom André",
  ryan: "Vascaíno Dom Ryan",
  "ryan silva": "Vascaíno Dom Ryan",
};

const spokenOperatorName = (
  value: unknown,
  options: { defaultHonorific?: boolean } = {},
): string => {
  const name = cleanSpeechValue(value, "não informado");
  const normalizedName = normalizeOperatorName(name);
  const nameWithoutHonorific = normalizedName.replace(/^dom\s+/, "");
  const specialName = SPECIAL_SPOKEN_OPERATOR_NAMES[normalizedName]
    ?? SPECIAL_SPOKEN_OPERATOR_NAMES[nameWithoutHonorific];

  if (specialName) return specialName;
  if (options.defaultHonorific && !normalizeOperatorName(name).startsWith("dom ")) {
    return `dom ${name}`;
  }
  return name;
};

const ticketCode = (type: NotificationType, data: NotificationData): string | undefined => {
  if (type === "pesquisa_satisfacao") {
    return cleanSpeechValue((data as PesquisaSatisfacaoData).ticket, "");
  }
  if ("codigo" in data && data.codigo !== undefined && data.codigo !== null) {
    return String(data.codigo);
  }
  return undefined;
};

export function getNotificationDedupeKey(
  type: NotificationType,
  data: NotificationData,
): string {
  if (data.dedupeKey?.trim()) return data.dedupeKey.trim();

  const code = ticketCode(type, data);
  if (code) return `${type}:${code}`;

  if (type === "erro_milvus") {
    const error = data as ErroMilvusData;
    return [type, error.status, error.endpoint ?? "", error.message].join(":");
  }

  return `${type}:${JSON.stringify(data)}`;
}

export function buildAnnouncementText(
  type: NotificationType,
  data: NotificationData,
): string {
  switch (type) {
    case "novo_chamado": {
      const ticket = data as NovoChamadoData;
      if (ticket.chatbotWaiting) {
        return `O chamado do cliente ${cleanSpeechValue(ticket.nome_fantasia, "não informado")} está no chat do Ippolo Hub esperando atendimento.`;
      }
      return `Novo chamado do cliente ${cleanSpeechValue(ticket.nome_fantasia, "não informado")}. Assunto: ${cleanSpeechValue(ticket.assunto, "não informado")}.`;
    }
    case "chamado_atribuido": {
      const ticket = data as ChamadoAtribuidoData;
      return `O operador ${spokenOperatorName(ticket.nome, { defaultHonorific: true })}, assumiu o chamado do cliente ${cleanSpeechValue(ticket.nome_fantasia, "não informado")}.`;
    }
    case "pesquisa_satisfacao": {
      const survey = data as PesquisaSatisfacaoData;
      return `Nova avaliação. O cliente ${cleanSpeechValue(survey.razao_social, "não informado")}, avaliou o operador ${spokenOperatorName(survey.operador)}, com nota ${cleanSpeechValue(survey.nota, "não informada")}.`;
    }
    case "chamado_excluido": {
      const ticket = data as ChamadoExcluidoData;
      return `O chamado do cliente ${cleanSpeechValue(ticket.nome_fantasia, "não informado")}, foi identificado como excluído no Milvus.`;
    }
    case "finalizado": {
      const ticket = data as FinalizadoData;
      return `O chamado do cliente ${cleanSpeechValue(ticket.nome_fantasia, "não informado")}, foi finalizado pelo operador ${spokenOperatorName(ticket.nome)}.`;
    }
    case "sla_aviso": {
      const ticket = data as SLAAvisoData;
      return `Atenção. O chamado do cliente ${cleanSpeechValue(ticket.nome_fantasia, "não informado")} está há ${ticket.minutos} minutos sem atendimento.`;
    }
    case "sla_estourado": {
      const ticket = data as SLAEstouradoData;
      return `Alerta de SLA. O chamado do cliente ${cleanSpeechValue(ticket.nome_fantasia, "não informado")} ultrapassou o tempo de primeiro atendimento.`;
    }
    case "erro_milvus": {
      const error = data as ErroMilvusData;
      if (Number(error.status) === 502) return "";
      return `Atenção. Foi detectado um erro ${error.status} na comunicação com o Milvus.`;
    }
  }
}

const toneFor = (type: NotificationType): AnnouncementTone => ({
  novo_chamado: "ticket-open",
  chamado_atribuido: "ticket-assigned",
  pesquisa_satisfacao: "ticket-rated",
  chamado_excluido: "ticket-deleted",
  finalizado: "ticket-finished",
  sla_aviso: "warning",
  sla_estourado: "critical",
  erro_milvus: "error",
})[type] as AnnouncementTone;

const toDetectedAt = (data: ChamadoExcluidoData): number | undefined => {
  const value = data.detectadoEm ?? data.detectedAt;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

export class NotificationStore {
  private notifications: AppNotification[] = [];
  private listeners = new Set<NotificationListener>();
  private seenDedupeKeys = new Map<string, string>();
  private counter = 0;

  constructor(private readonly queue: AnnouncementQueuePort = announcementQueue) {}

  add(type: NotificationType, data: NotificationData, duration = DEFAULT_CARD_MS): string {
    const dedupeKey = getNotificationDedupeKey(type, data);
    const duplicateId = this.seenDedupeKeys.get(dedupeKey);
    if (duplicateId) return duplicateId;

    const id = `notif-${++this.counter}-${Date.now()}`;
    const notification: AppNotification = {
      id,
      type,
      data,
      createdAt: Date.now(),
      duration: Math.max(MINIMUM_CARD_MS, duration),
      dedupeKey,
      announcementText: buildAnnouncementText(type, data),
      phase: "waiting",
      detectedAt: type === "chamado_excluido"
        ? toDetectedAt(data as ChamadoExcluidoData) ?? Date.now()
        : undefined,
    };

    this.notifications.push(notification);
    this.seenDedupeKeys.set(dedupeKey, id);
    this.notify();

    const queued = this.queue.enqueue({
      id,
      text: notification.announcementText,
      tone: toneFor(type),
      source: "ticket",
      minimumDisplayMs: notification.duration,
      gapAfterMs: 450,
      onPhase: (phase) => this.setPhase(id, phase),
      onComplete: () => this.complete(id),
    });

    if (!queued) this.complete(id);
    return id;
  }

  remove(id: string): void {
    if (!this.notifications.some((notification) => notification.id === id)) return;
    if (!this.queue.cancel(id, "cancelled")) this.complete(id);
  }

  subscribe(listener: NotificationListener): () => void {
    this.listeners.add(listener);
    listener(this.getAll());
    return () => this.listeners.delete(listener);
  }

  getAll(): AppNotification[] {
    return this.notifications.map((notification) => ({ ...notification }));
  }

  getActive(): AppNotification | null {
    const active = this.notifications.find((notification) => notification.phase !== "waiting");
    return active ? { ...active } : null;
  }

  private setPhase(id: string, phase: AnnouncementPhase): void {
    let changed = false;
    this.notifications = this.notifications.map((notification) => {
      if (notification.id !== id || notification.phase === phase) return notification;
      changed = true;
      return { ...notification, phase };
    });
    if (changed) this.notify();
  }

  private complete(id: string): void {
    const previousLength = this.notifications.length;
    this.notifications = this.notifications.filter((notification) => notification.id !== id);
    if (this.notifications.length !== previousLength) this.notify();
  }

  private notify(): void {
    const snapshot = this.getAll();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

export const notificationStore = new NotificationStore();

// Reexportado para consumidores que precisem somente das interfaces da fila.
export type { AnnouncementPhase, AnnouncementQueue };
