import { useMemo, useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useFilters } from "@/context/FilterContext";
import { useTicketsData } from "@/hooks/api/useTicketsData";
import { format, parseISO, isValid, startOfDay, endOfDay, differenceInCalendarDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  aggregateTicketData,
  calculateSLADistribution,
} from "@/services/dataAggregator";
import {
  calculateSlaTimeAverage,
  calculateSlaTimeByOperator,
  getPredominantSlaTarget,
  parseSlaDurationMinutes,
} from "@/services/slaTimeMetrics";
import {
  fetchNativeSlaTickets,
  type SlaTicketDetail,
} from "@/services/slaTicketService";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  Phone,
  Timer,
  Clock4,
  AlertTriangle,
  Activity,
  Star,
  RefreshCw,
  Download,
  Loader2,
  SmilePlus,
  Trophy,
  Medal,
  ArrowUp,
  ArrowDown,
  Minus,
} from "lucide-react";
import { newTicketsStore } from "@/stores/newTicketsStore";
import { notificationStore } from "@/stores/notificationStore";
import { announcementQueue } from "@/services/announcementQueue";
import {
  classifyTicketReportSnapshot,
  isTicketDeleted,
  isTicketFinished,
} from "@/services/ticketReportClassifier";
import {
  getAnsweredSatisfactionKey,
  isSatisfactionEvaluationNewSince,
  isSatisfactionEvaluationWithinRange,
  parseSatisfactionScore,
} from "@/services/satisfactionSurveyClassifier";
import { ManagementDashboard } from "@/components/management-dashboard";

const META_RESPOSTA_MINUTOS = 5;
const META_ATENDIMENTO_HORAS = 4;

// Opções de intervalo de atualização automática
const REFRESH_OPTIONS = [
  { label: "30 seg", value: "30000" },
  { label: "1 min", value: "60000" },
  { label: "2min 30s", value: "150000" },
  { label: "5 min", value: "300000" },
  { label: "10 min", value: "600000" },
  { label: "20 min", value: "1200000" },
  { label: "30 min", value: "1800000" },
];

// Opções de período rápido
const PERIOD_OPTIONS = [
  { label: "Semana até hoje", value: "week_to_date" },
  { label: "Mês até hoje", value: "month_to_date" },
  { label: "Últimos 7 dias", value: "last_7_days" },
  { label: "Últimos 14 dias", value: "last_14_days" },
  { label: "Últimos 30 dias", value: "last_30_days" },
];

const parseDateSafely = (value?: string | null) => {
  if (!value) return null;

  const parsers = [
    () => parseISO(value),
    () => parseISO(value.replace(" ", "T")),
    () => parseISO(value + "Z"),
    () => parseISO(value.split(" ")[0]),
  ];

  for (const tryParse of parsers) {
    try {
      const parsed = tryParse();
      if (isValid(parsed)) return parsed;
    } catch (err) {
      // ignore
    }
  }
  return null;
};

const formatMinutosCompleto = (minutos: number): string => {
  const totalSegundos = Math.round(minutos * 60);
  const horas = Math.floor(totalSegundos / 3600);
  const mins = Math.floor((totalSegundos % 3600) / 60);
  const secs = totalSegundos % 60;
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${pad(horas)}:${pad(mins)}:${pad(secs)}`;
};

const parseDateRangeDias = (dataInicial?: string, dataFinal?: string) => {
  if (!dataInicial || !dataFinal) return 30;
  const inicio = new Date(dataInicial.replace(" ", "T"));
  const fim = new Date(dataFinal.replace(" ", "T"));
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) return 30;
  // Conta dias de forma inclusiva (mesmo dia = 1)
  const dias = differenceInCalendarDays(endOfDay(fim), startOfDay(inicio)) + 1;
  return Math.max(dias, 1);
};

// Mapas de avatar por nome (coloque as imagens em public/avatars/<arquivo>.png)
const avatarMap: Record<string, string> = {
  moraes: "/avatars/Moraes.png",
  victor: "/avatars/Victor.png",
  abraao: "/avatars/Abraão.png",
  carlos: "/avatars/Carlos.png",
  alves: "/avatars/Alves.png",
  bruno: "/avatars/Bruno.png",
  paulo: "/avatars/Paulo.png",
  celio: "/avatars/Célio.png",
  ryan: "/avatars/Ryan.png",
};

const normalizeName = (value: string) =>
  value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const getAvatarSrc = (nome: string) => {
  const key = normalizeName(nome);
  const byMap = avatarMap[key];
  if (byMap) return byMap;

  // Tenta pelo primeiro nome se o nome completo falhar
  const primeiroNome = key.split(' ')[0];
  if (avatarMap[primeiroNome]) return avatarMap[primeiroNome];

  // tenta ascii e o nome original como fallback
  return `/avatars/${key}.png`;
};



const parseDataPesquisa = (value?: string | null) => {
  if (!value) return null;
  try {
    const parsed = parseISO(value);
    if (isValid(parsed)) return parsed;
    const parts = value.split('/');
    if (parts.length === 3) {
      const [day, month, year] = parts;
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      if (isValid(date)) return date;
    }
  } catch { }
  return null;
};

const readOperatorCandidate = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';

  const record = value as Record<string, unknown>;
  for (const key of ['nome', 'name', 'text', 'tecnico', 'operador']) {
    if (typeof record[key] === 'string' && record[key].trim()) {
      return record[key].trim();
    }
  }
  return '';
};

const isAssignedOperatorName = (value: string) => {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

  return Boolean(normalized) && ![
    'nao atribuido',
    'sem tecnico',
    'sem operador',
    'null',
    'undefined',
    '[object object]',
    '-',
  ].includes(normalized);
};

const normalizeChatbotName = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');

const isChatbotOperatorName = (value: string): boolean =>
  normalizeChatbotName(value).startsWith('integracaochatbot');

const resolveTicketOperator = (ticket: any): string => {
  const candidates = [
    ticket?.tecnico,
    ticket?.operador,
    ticket?.nome,
    ticket?.responsavel,
    ticket?.atendente,
    ticket?.ultima_log?.tecnico,
    ticket?.ultimo_log?.tecnico,
  ];

  for (const candidate of candidates) {
    const name = readOperatorCandidate(candidate);
    if (isAssignedOperatorName(name)) return name;
  }
  return '';
};

const isChatbotIntegrationTicket = (ticket: any, operator: string): boolean =>
  isChatbotOperatorName(operator) || (
    normalizeChatbotName(String(ticket?.origem ?? '')) === 'integracao' &&
    String(ticket?.descricao ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .includes('dados informados pelo cliente')
  );

export type HomeMode = "dashboard" | "management";

interface HomeProps {
  mode?: HomeMode;
}

type SatisfactionAlertData = {
  ticket: string;
  razao_social: string;
  operador: string;
  nota: string;
  contato: string;
  descricao_avaliacao: string;
  data_avaliacao: string;
};

const enqueueSatisfactionNotification = (pesquisa: SatisfactionAlertData) => {
  notificationStore.add('pesquisa_satisfacao', {
    ticket: pesquisa.ticket,
    razao_social: pesquisa.razao_social,
    operador: pesquisa.operador,
    nota: pesquisa.nota,
    contato: pesquisa.contato,
    descricao_avaliacao: pesquisa.descricao_avaliacao,
    data_avaliacao: pesquisa.data_avaliacao,
  });
};

const MANAGEMENT_REFRESH_INTERVAL = 30_000;
const MANAGEMENT_SOUND_KEY = "polo-bi-management-sound-enabled";
const MANAGEMENT_SOUND_EVENT = "polo-bi:management-sound-change";
const SATISFACTION_NOTIFICATION_GRACE_MS = 2 * 60_000;
const MAX_SATISFACTION_NOTIFICATIONS_PER_REFRESH = 20;

export default function Home({ mode = "dashboard" }: HomeProps) {
  const isManagement = mode === "management";
  const { filters, updateFilters } = useFilters();
  const { data: ticketsResponse, isLoading, isError, error, refetch, isFetching } = useTicketsData(filters, true);
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const soundEnabledRef = useRef(
    !isManagement || localStorage.getItem(MANAGEMENT_SOUND_KEY) !== "false"
  );
  const lastMilvus502ToastAtRef = useRef(0);

  const canPresentRealtimeAlert = () => document.visibilityState === "visible";

  useEffect(() => {
    announcementQueue.setMuted(isManagement && !soundEnabledRef.current);

    if (!isManagement) return;

    const handleSoundPreference = (event: Event) => {
      const detail = (event as CustomEvent<{ enabled?: boolean }>).detail;
      soundEnabledRef.current = detail?.enabled !== false;
      announcementQueue.setMuted(!soundEnabledRef.current);
    };

    window.addEventListener(MANAGEMENT_SOUND_EVENT, handleSoundPreference);
    return () => window.removeEventListener(MANAGEMENT_SOUND_EVENT, handleSoundPreference);
  }, [isManagement]);

  // Ref para capturar o conteúdo do relatório
  const reportRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Função para exportar PDF - Relatório Estilizado
  const exportToPDF = async () => {
    setIsExporting(true);
    toast({
      title: "Gerando Relatório PDF...",
      description: "Aguarde enquanto o relatório é criado.",
    });

    try {
      const { default: jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 15;
      let y = margin;

      // HEADER CINZA
      pdf.setFillColor(51, 65, 85); // slate-700
      pdf.rect(0, 0, pageWidth, 35, 'F');

      // Logo (carregar imagem)
      try {
        const logoImg = new Image();
        logoImg.crossOrigin = 'anonymous';
        logoImg.src = '/Icone_Logo.png';
        await new Promise((resolve) => { logoImg.onload = resolve; logoImg.onerror = resolve; });
        if (logoImg.complete && logoImg.naturalWidth > 0) {
          const canvas = document.createElement('canvas');
          canvas.width = logoImg.naturalWidth;
          canvas.height = logoImg.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(logoImg, 0, 0);
          const logoData = canvas.toDataURL('image/png');
          pdf.addImage(logoData, 'PNG', margin, 5, 25, 25);
        }
      } catch (e) { /* logo opcional */ }

      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(22);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Polo BI - Relatório Visão Geral', margin + 30, 16);
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.text('Dashboard Executivo de Atendimento', margin + 30, 24);
      const periodoStr = filters.data_inicial && filters.data_final
        ? `Período: ${format(new Date(filters.data_inicial), 'dd/MM/yyyy')} a ${format(new Date(filters.data_final), 'dd/MM/yyyy')}`
        : 'Período: Últimos 30 dias';
      pdf.setFontSize(9);
      pdf.text(periodoStr, pageWidth - margin - 65, 16);
      pdf.text(`Gerado em: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, pageWidth - margin - 65, 24);

      y = 45;

      // KPIs
      const kpiW = (pageWidth - margin * 2 - 40) / 5;
      const kpis = [
        { label: 'Total Tickets', value: String(ticketsFinalizadosExibicao), c: [59, 130, 246] },
        { label: 'Resp. em Dia', value: String(respostasDentroSla), c: [34, 197, 94] },
        { label: 'Atend. em Dia', value: String(solucoesDentroSla), c: [34, 197, 94] },
        { label: 'Resp. Estourada', value: `${metricasSLAExibicao.respostaEstourada}`, c: [239, 68, 68] },
        { label: 'Atend. Expirado', value: `${metricasSLAExibicao.solucaoEstourada}`, c: [239, 68, 68] },
      ];
      kpis.forEach((kpi, i) => {
        const x = margin + 10 + i * (kpiW + 8);
        pdf.setFillColor(kpi.c[0], kpi.c[1], kpi.c[2]);
        pdf.roundedRect(x, y, kpiW, 25, 2, 2, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(18);
        pdf.setFont('helvetica', 'bold');
        pdf.text(kpi.value, x + kpiW / 2, y + 12, { align: 'center' });
        pdf.setFontSize(8);
        pdf.setFont('helvetica', 'normal');
        pdf.text(kpi.label, x + kpiW / 2, y + 20, { align: 'center' });
      });

      y += 35;

      // TEMPOS
      const boxW = (pageWidth - margin * 2 - 10) / 2;
      pdf.setFillColor(30, 41, 59);
      pdf.roundedRect(margin, y, boxW, 30, 3, 3, 'F');
      pdf.roundedRect(margin + boxW + 10, y, boxW, 30, 3, 3, 'F');

      pdf.setTextColor(96, 165, 250);
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Tempo Médio de Resposta', margin + 10, y + 12);
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(16);
      pdf.text(formatMinutosCompleto(temposExibicao.tempoMedioAbertura), margin + 10, y + 24);

      pdf.setTextColor(52, 211, 153);
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Tempo Médio de Atendimento', margin + boxW + 20, y + 12);
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(16);
      pdf.text(formatMinutosCompleto(temposExibicao.tempoMedioSolucao), margin + boxW + 20, y + 24);

      y += 40;

      // RANKING
      pdf.setTextColor(30, 41, 59);
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Top Operadores', margin, y);
      y += 6;

      pdf.setFillColor(241, 245, 249);
      pdf.rect(margin, y, pageWidth - margin * 2, 8, 'F');
      pdf.setTextColor(71, 85, 105);
      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'bold');
      pdf.text('#', margin + 5, y + 5.5);
      pdf.text('Operador', margin + 20, y + 5.5);
      pdf.text('Tickets', margin + 100, y + 5.5);
      pdf.text('Média/Dia', margin + 140, y + 5.5);
      y += 8;

      rankingOperadores.slice(0, 10).forEach((op, i) => {
        const bg = i % 2 === 0 ? [255, 255, 255] : [248, 250, 252];
        pdf.setFillColor(bg[0], bg[1], bg[2]);
        pdf.rect(margin, y, pageWidth - margin * 2, 6, 'F');
        pdf.setTextColor(30, 41, 59);
        pdf.setFontSize(8);
        pdf.setFont('helvetica', 'normal');
        pdf.text(`${i + 1}`, margin + 5, y + 4.5);
        pdf.text(op.nome, margin + 20, y + 4.5);
        pdf.setFont('helvetica', 'bold');
        pdf.text(String(op.total), margin + 100, y + 4.5);
        pdf.setFont('helvetica', 'normal');
        pdf.text(op.mediaDiaria.toFixed(2), margin + 140, y + 4.5);
        y += 6;
      });

      // FOOTER
      pdf.setDrawColor(226, 232, 240);
      pdf.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
      pdf.setTextColor(148, 163, 184);
      pdf.setFontSize(8);
      pdf.text('Polo Telecom - Business Intelligence', margin, pageHeight - 6);
      pdf.text('Página 1', pageWidth - margin - 20, pageHeight - 6);

      pdf.save(`relatorio-${format(new Date(), 'yyyy-MM-dd-HHmm')}.pdf`);
      toast({ title: "Relatório exportado!", description: "PDF salvo com sucesso." });
    } catch (error) {
      console.error('Erro:', error);
      toast({ title: "Erro", description: "Falha ao gerar PDF.", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  // Estado para intervalo de atualização automática
  const [refreshInterval, setRefreshInterval] = useState<number | null>(() => {
    if (isManagement) return MANAGEMENT_REFRESH_INTERVAL;
    const saved = localStorage.getItem('dashboard-refresh-interval');
    return saved ? parseInt(saved, 10) : null;
  });

  const [previousTicketCount, setPreviousTicketCount] = useState<number | null>(null);

  // Set para rastrear IDs de chamados abertos anteriores
  const previousOpenTicketIdsRef = useRef<Set<number>>(new Set());
  const openTicketsInitializedRef = useRef<boolean>(false);

  // Mapa para rastrear técnico atribuído por chamado: { codigo: tecnico }
  const previousTicketTecnicosRef = useRef<Map<number, string>>(new Map());

  type TicketContext = { assunto?: string; cliente?: string; operador?: string };
  const ticketContextCacheRef = useRef<Map<string, TicketContext>>(new Map());
  const openTicketsRequestSequenceRef = useRef(0);
  const lastAppliedOpenTicketsRequestRef = useRef(0);
  const initialOpenTicketsRequestedRef = useRef(false);
  const finalizedTicketsInitializedRef = useRef(false);
  const knownFinalizedTicketIdsRef = useRef<Set<string>>(new Set());
  const finalizedTicketsRequestSequenceRef = useRef(0);
  const lastAppliedFinalizedTicketsRequestRef = useRef(0);

  const cacheOpenTicketContexts = (tickets: any[]) => {
    tickets.forEach((ticket) => {
      const codigo = String(ticket.codigo || ticket.id || "").trim();
      if (!codigo) return;

      const previous = ticketContextCacheRef.current.get(codigo);
      ticketContextCacheRef.current.set(codigo, {
        assunto: ticket.assunto || previous?.assunto,
        cliente: ticket.nome_fantasia || ticket.cliente || previous?.cliente,
        operador: resolveTicketOperator(ticket) || previous?.operador,
      });
    });
  };

  // SLA Primeiro Atendimento: timers para chamados sem operador
  // Cada entrada guarda os IDs dos timeouts de 4min (aviso) e 5min (estourado)
  const slaTimersRef = useRef<Map<number, { avisoTimer: ReturnType<typeof setTimeout> | null; estouradoTimer: ReturnType<typeof setTimeout> | null }>>(new Map());

  const clearSlaTimers = (codigo: number) => {
    const timers = slaTimersRef.current.get(codigo);
    if (!timers) return;
    if (timers.avisoTimer) clearTimeout(timers.avisoTimer);
    if (timers.estouradoTimer) clearTimeout(timers.estouradoTimer);
    slaTimersRef.current.delete(codigo);
  };

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [nextRefreshIn, setNextRefreshIn] = useState<number | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [refreshScheduleVersion, setRefreshScheduleVersion] = useState(0);
  const refreshInFlightRef = useRef(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Estado para exibir contagem e dados de chamados abertos (Atendendo + Pausado)
  const [openTicketsCount, setOpenTicketsCount] = useState<number>(0);
  const [chamadosAtivos, setChamadosAtivos] = useState<any[]>([]);

  // Estado para rastrear ranking do INÍCIO do dia (para indicadores de mudança de posição)
  // Ao abrir o dashboard pela primeira vez no dia, salva o ranking como referência
  // Durante o dia, as atualizações automáticas comparam com essa referência
  const [startOfDayRanking, setStartOfDayRanking] = useState<Map<string, number>>(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const savedData = localStorage.getItem('dashboard-start-of-day-ranking');

    if (savedData) {
      try {
        const { date, ranking } = JSON.parse(savedData);

        // Se temos dados de hoje, usar o ranking do início do dia
        if (date === today && ranking) {
          return new Map(Object.entries(ranking));
        }
      } catch { }
    }
    return new Map(); // Novo dia ou primeira vez - será inicializado depois
  });

  // Flag para saber se já salvou o ranking de referência do dia
  const startOfDayRankingSavedRef = useRef<boolean>((() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const savedData = localStorage.getItem('dashboard-start-of-day-ranking');
    if (savedData) {
      try {
        const { date } = JSON.parse(savedData);
        return date === today;
      } catch { }
    }
    return false;
  })());
  const rankingInitializedRef = useRef<boolean>(false);

  // Função para buscar chamados abertos
  const fetchOpenTickets = async () => {
    const requestSequence = ++openTicketsRequestSequenceRef.current;

    try {
      const response = await fetch('/api/proxy/chamado/listagem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ChamadosAbertos', total_registros: 100 }),
      });

      if (!response.ok) {
        console.error(`🚨 Erro na API de chamados abertos: ${response.status}`);
        return null;
      }

      const data = await response.json();
      if (!Array.isArray(data?.lista)) return null;
      if (requestSequence < lastAppliedOpenTicketsRequestRef.current) return null;
      lastAppliedOpenTicketsRequestRef.current = requestSequence;
      cacheOpenTicketContexts(data.lista);
      return data.lista;
    } catch (e) {
      console.error('Erro ao buscar chamados abertos:', e);
      return null;
    }
  };

  // A exportação CSV "Ticket" é truncada pela Milvus em 10.000 linhas
  // antigas. Esta consulta acompanha os encerramentos recentes pela listagem
  // oficial, ordenada por data de solução.
  const fetchFinalizedTickets = async () => {
    const requestSequence = ++finalizedTicketsRequestSequenceRef.current;

    try {
      const response = await fetch('/api/proxy/chamado/listagem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'Finalizado',
          pagina: 1,
          total_registros: 100,
        }),
      });

      if (!response.ok) return null;
      const data = await response.json();
      if (!Array.isArray(data?.lista)) return null;
      if (requestSequence < lastAppliedFinalizedTicketsRequestRef.current) return null;
      lastAppliedFinalizedTicketsRequestRef.current = requestSequence;

      const finalizedTickets = data.lista.filter((ticket: any) =>
        isTicketFinished(ticket?.status)
      );
      cacheOpenTicketContexts(finalizedTickets);

      if (!finalizedTicketsInitializedRef.current) {
        finalizedTickets.forEach((ticket: any) => {
          const ticketId = String(ticket?.codigo || ticket?.id || '').trim();
          if (ticketId) knownFinalizedTicketIdsRef.current.add(ticketId);
        });
        finalizedTicketsInitializedRef.current = true;
        return { notifications: 0 };
      }

      // A API retorna do mais novo para o mais antigo; a fila narra na ordem
      // cronológica quando mais de um chamado termina entre duas consultas.
      const newFinalizedTickets = finalizedTickets
        .filter((ticket: any) => {
          const ticketId = String(ticket?.codigo || ticket?.id || '').trim();
          return ticketId && !knownFinalizedTicketIdsRef.current.has(ticketId);
        })
        .reverse();

      let notifications = 0;
      newFinalizedTickets.forEach((ticket: any) => {
        const ticketId = String(ticket?.codigo || ticket?.id || '').trim();
        const codigo = Number(ticketId);
        if (!ticketId || !Number.isFinite(codigo)) return;

        knownFinalizedTicketIdsRef.current.add(ticketId);
        notifiedFinishedTicketsRef.current.add(ticketId);
        clearSlaTimers(codigo);

        const context = ticketContextCacheRef.current.get(ticketId);
        notificationStore.add('finalizado', {
          codigo,
          assunto: ticket.assunto || context?.assunto || 'Chamado finalizado',
          nome: resolveTicketOperator(ticket) || context?.operador || 'Operador',
          nome_fantasia:
            ticket.nome_fantasia || ticket.cliente || context?.cliente || 'Cliente',
        });
        notifications += 1;
      });

      return { notifications };
    } catch (error) {
      console.error('Erro ao buscar chamados finalizados:', error);
      return null;
    }
  };

  // Estado para Top 3 de pesquisas avaliadas
  const [rankingPesquisas, setRankingPesquisas] = useState<Array<{ operador: string; quantidade: number }>>([]);

  // Rastrear pesquisas já vistas para detectar novas (usando ticket como chave única)
  const previousPesquisaTicketsRef = useRef<Set<string>>(new Set());
  const pesquisasInitializedRef = useRef<boolean>(false);
  const lastPesquisaNotificationSyncRef = useRef<Date | null>(null);
  const pesquisaSourceRef = useRef<string | null>(null);
  const pesquisaNotificationSequenceRef = useRef(0);
  const lastAppliedPesquisaNotificationRef = useRef(0);
  const pesquisaAuxiliarySequenceRef = useRef(0);
  const lastAppliedPesquisaAuxiliaryRef = useRef(0);
  const auxiliaryPesquisaFilterKeyRef = useRef<string | null>(null);

  // Função para buscar pesquisas de satisfação
  const fetchPesquisas = async (
    detectNotifications = true,
    enqueueNotifications = true,
  ) => {
    const requestStartedAt = new Date();
    const sequenceRef = detectNotifications
      ? pesquisaNotificationSequenceRef
      : pesquisaAuxiliarySequenceRef;
    const lastAppliedRef = detectNotifications
      ? lastAppliedPesquisaNotificationRef
      : lastAppliedPesquisaAuxiliaryRef;
    const requestSequence = ++sequenceRef.current;

    try {
      const response = await fetch('/api/proxy/pesquisas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data_inicial: filters.data_inicial,
          data_final: filters.data_final,
        }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      if (!Array.isArray(data?.lista)) return null;
      if (requestSequence < lastAppliedRef.current) return null;
      lastAppliedRef.current = requestSequence;
      const pesquisas = data.lista;
      const currentSource = typeof data?.meta?.source === "string"
        ? data.meta.source
        : "unknown";

      // Detectar NOVAS pesquisas de satisfação respondidas
      // Chave única: ticket + nota + operador (identifica avaliação específica)
      const currentPesquisaKeys = new Set<string>();
      const novasPesquisas: SatisfactionAlertData[] = [];

      pesquisas.forEach((p: any) => {
        if (isTicketDeleted(p.ticket_excluido)) return;
        const chave = getAnsweredSatisfactionKey(p);
        if (!chave) return;
        currentPesquisaKeys.add(chave);
      });

      const wasInitialized = pesquisasInitializedRef.current;
      const sourceChanged = pesquisaSourceRef.current !== null
        && pesquisaSourceRef.current !== currentSource;
      const lastNotificationSync = lastPesquisaNotificationSyncRef.current;

      if (wasInitialized && detectNotifications && !sourceChanged && lastNotificationSync) {
        // Encontrar pesquisas que não existiam no polling anterior
        const notificationThreshold = new Date(
          lastNotificationSync.getTime() - SATISFACTION_NOTIFICATION_GRACE_MS,
        );
        const candidates: SatisfactionAlertData[] = [];

        pesquisas.forEach((p: any) => {
          if (isTicketDeleted(p.ticket_excluido)) return;
          const chave = getAnsweredSatisfactionKey(p);
          if (!chave) return;

          if (previousPesquisaTicketsRef.current.has(chave)) return;
          if (!isSatisfactionEvaluationNewSince(p, notificationThreshold)) return;

          candidates.push({
            ticket: p.ticket || '',
            razao_social: p.razao_social || '',
            operador: p.operador || '',
            nota: p.nota || '',
            contato: p.contato || '',
            descricao_avaliacao: p.descricao_avaliacao || '',
            data_avaliacao: p.data_avaliacao || '',
          });
        });

        // Centenas de itens indicam carga histórica, troca de fonte ou reparo
        // de dados. Nesses casos atualizamos a base sem lotar a fila de voz.
        if (candidates.length <= MAX_SATISFACTION_NOTIFICATIONS_PER_REFRESH) {
          candidates.forEach((pesquisa) => {
            console.log('⭐ NOVA PESQUISA DE SATISFAÇÃO:', pesquisa.ticket, '- Operador:', pesquisa.operador, '- Nota:', pesquisa.nota, '- Data:', pesquisa.data_avaliacao);
            novasPesquisas.push(pesquisa);
          });
        } else {
          console.warn(
            'Pesquisas: lote histórico ignorado para notificações:',
            candidates.length,
          );
        }
      } else if (!wasInitialized) {
        console.log('📋 Pesquisas - Primeira execução, inicializando base com', currentPesquisaKeys.size, 'pesquisas');
        pesquisasInitializedRef.current = true;
      }

      if (sourceChanged) {
        console.info(
          'Pesquisas: fonte alterada; histórico usado somente como nova base.',
          pesquisaSourceRef.current,
          '→',
          currentSource,
        );
        previousPesquisaTicketsRef.current = new Set(currentPesquisaKeys);
      }

      // Consultas apenas para filtros não consomem eventos antes do polling coordenado.
      if (!wasInitialized || detectNotifications) {
        currentPesquisaKeys.forEach((key) => previousPesquisaTicketsRef.current.add(key));
        lastPesquisaNotificationSyncRef.current = requestStartedAt;
        pesquisaSourceRef.current = currentSource;
      }

      // A store coordena card, tom e fala em FIFO, sem cortar outros avisos.
      if (novasPesquisas.length > 0 && enqueueNotifications) {
        console.log('⭐ Total de novas pesquisas detectadas:', novasPesquisas.length);

        novasPesquisas.forEach(enqueueSatisfactionNotification);
      }

      // Calcular ranking por quantidade de pesquisas avaliadas (com nota)
      // Também calcula a média para usar como critério de desempate
      const map = new Map<string, { quantidade: number; somaNotas: number }>();

      // Preparar datas do filtro
      const dataInicialDate = filters.data_inicial ? parseDataPesquisa(filters.data_inicial) : null;
      const dataFinalDate = filters.data_final ? parseDataPesquisa(filters.data_final) : null;

      pesquisas.forEach((p: any) => {
        // Ignorar tickets excluídos
        if (isTicketDeleted(p.ticket_excluido)) return;

        // O período do ranking representa quando o cliente respondeu à avaliação,
        // independentemente da data em que o chamado foi criado.
        if (dataInicialDate && dataFinalDate) {
          if (!isSatisfactionEvaluationWithinRange(
            p,
            startOfDay(dataInicialDate),
            endOfDay(dataFinalDate),
          )) {
            return;
          }
        }

        const nota = parseSatisfactionScore(p.nota);
        if (p.operador && nota !== null) {
          const atual = map.get(p.operador) || { quantidade: 0, somaNotas: 0 };
          map.set(p.operador, { quantidade: atual.quantidade + 1, somaNotas: atual.somaNotas + nota });
        }
      });
      const ranking = Array.from(map.entries())
        .map(([operador, data]) => ({
          operador,
          quantidade: data.quantidade,
          media: data.quantidade > 0 ? data.somaNotas / data.quantidade : 0,
        }))
        .sort((a, b) => {
          // 1º critério: quantidade (maior primeiro)
          if (b.quantidade !== a.quantidade) return b.quantidade - a.quantidade;
          // 2º critério (desempate): média das notas (maior primeiro)
          if (b.media !== a.media) return b.media - a.media;
          // 3º critério (desempate final): ordem alfabética
          return a.operador.localeCompare(b.operador);
        })
        .slice(0, 3);
      setRankingPesquisas(ranking);
      return { notifications: novasPesquisas.length, events: novasPesquisas };
    } catch (e) {
      console.error('Erro ao buscar pesquisas:', e);
      return null;
    }
  };

  // Buscar pesquisas ao montar o componente
  // Buscar pesquisas ao montar o componente ou mudar filtros
  useEffect(() => {
    const filterKey = `${filters.data_inicial || ''}|${filters.data_final || ''}`;
    if (isFetching || auxiliaryPesquisaFilterKeyRef.current === filterKey) return;
    auxiliaryPesquisaFilterKeyRef.current = filterKey;
    void fetchPesquisas(false);
  }, [filters.data_inicial, filters.data_final, isFetching]);

  // ========== RELATÓRIO DE TICKETS DETALHADO (para cálculos de tempo precisos) ==========
  type TicketDetalhado = SlaTicketDetail;

  const [ticketsDetalhados, setTicketsDetalhados] = useState<TicketDetalhado[]>([]);
  const ticketReportInitializedRef = useRef(false);
  const ticketReportSequenceRef = useRef(0);
  const lastAppliedTicketReportRef = useRef(0);
  const previousDetailedTicketsRef = useRef<Map<string, TicketDetalhado>>(new Map());
  const notifiedDeletedTicketsRef = useRef<Set<string>>(new Set());
  const notifiedFinishedTicketsRef = useRef<Set<string>>(new Set());
  const detailedTicketFilterKeyRef = useRef('');

  // Função para buscar relatório de tickets detalhado
  const fetchRelatorioTickets = async () => {
    const requestSequence = ++ticketReportSequenceRef.current;

    try {
      const currentTickets = await fetchNativeSlaTickets({
        data_inicial: filters.data_inicial,
        data_final: filters.data_final,
        analista: filters.analista,
        mesa_trabalho: filters.mesa_trabalho,
      });

      // Uma resposta mais antiga nunca pode fazer o baseline retroceder.
      if (requestSequence < lastAppliedTicketReportRef.current) return null;
      lastAppliedTicketReportRef.current = requestSequence;

      console.log('🔄 fetchRelatorioTickets - Atualizando dados:', currentTickets.length, 'registros');

      // Uma resposta inicial vazia pode ser atraso do relatório; aguarda dados confirmáveis.
      if (!ticketReportInitializedRef.current && currentTickets.length === 0) {
        setTicketsDetalhados([]);
        return { notifications: 0 };
      }

      setTicketsDetalhados(currentTickets);

      const currentById = new Map<string, TicketDetalhado>();
      currentTickets.forEach((ticket) => {
        const ticketId = String(ticket.ticket || '').trim();
        if (!ticketId) return;
        currentById.set(ticketId, ticket);

        const cached = ticketContextCacheRef.current.get(ticketId);
        ticketContextCacheRef.current.set(ticketId, {
          assunto: cached?.assunto,
          cliente: cached?.cliente || ticket.nome_fantasia || ticket.contato,
          operador: ticket.operador || cached?.operador,
        });
      });

      // A primeira resposta é apenas baseline: não reproduz exclusões/finalizações históricas.
      if (!ticketReportInitializedRef.current) {
        previousDetailedTicketsRef.current = currentById;
        currentById.forEach((ticket, ticketId) => {
          if (isTicketDeleted(ticket.ticket_excluido)) notifiedDeletedTicketsRef.current.add(ticketId);
          if (isTicketFinished(ticket.status)) notifiedFinishedTicketsRef.current.add(ticketId);
        });
        ticketReportInitializedRef.current = true;
        return { notifications: 0 };
      }

      let notifications = 0;
      const { nextBaseline, transitions } = classifyTicketReportSnapshot(
        previousDetailedTicketsRef.current,
        currentTickets,
        notifiedDeletedTicketsRef.current,
      );

      for (const transition of transitions) {
        const { ticketId, current: ticket, type } = transition;
        const codigo = Number(ticketId);
        if (!Number.isFinite(codigo)) continue;

        const context = ticketContextCacheRef.current.get(ticketId);
        const cliente = context?.cliente || ticket.nome_fantasia || ticket.contato || 'Cliente';
        const operador = ticket.operador || context?.operador || 'Operador';
        const assunto = context?.assunto || 'Chamado finalizado';

        if (type === 'deleted' && !notifiedDeletedTicketsRef.current.has(ticketId)) {
          notifiedDeletedTicketsRef.current.add(ticketId);
          clearSlaTimers(codigo);
          notificationStore.add('chamado_excluido', {
            codigo,
            assunto: context?.assunto,
            nome_fantasia: cliente,
            nome: operador,
            operador,
            detectedAt: Date.now(),
          });
          notifications += 1;
          continue;
        }

        // Exclusão nunca é inferida/narrada como finalização.
        if (
          type === 'finalized' &&
          !notifiedFinishedTicketsRef.current.has(ticketId)
        ) {
          notifiedFinishedTicketsRef.current.add(ticketId);
          clearSlaTimers(codigo);
          notificationStore.add('finalizado', {
            codigo,
            assunto,
            nome: operador,
            nome_fantasia: cliente,
          });
          notifications += 1;
        }
      }

      // Registros ausentes são mantidos: atraso parcial do relatório não apaga o baseline.
      previousDetailedTicketsRef.current = nextBaseline;
      return { notifications };
    } catch (e) {
      console.error('Erro ao buscar relatório de tickets:', e);
      return null;
    }
  };

  // Mantém o relatório nativo sincronizado com o período exibido no painel.
  useEffect(() => {
    if (isFetching) return;
    const filterKey = [
      filters.data_inicial || '',
      filters.data_final || '',
      filters.analista || '',
      filters.mesa_trabalho || '',
    ].join('|');
    if (detailedTicketFilterKeyRef.current === filterKey) return;
    detailedTicketFilterKeyRef.current = filterKey;
    void Promise.all([fetchRelatorioTickets(), fetchFinalizedTickets()]);
  }, [
    isFetching,
    filters.data_inicial,
    filters.data_final,
    filters.analista,
    filters.mesa_trabalho,
  ]);

  // Função para parsear data+hora do CSV (formato dd/MM/yyyy e HH:mm:ss)
  const parseDataHoraCSV = (data: string, hora: string): Date | null => {
    if (!data || !hora || data === 'Não possui' || hora === 'Não possui') return null;
    try {
      // Data no formato dd/MM/yyyy
      const [day, month, year] = data.split('/').map(Number);
      // Hora no formato HH:mm:ss
      const [h, m, s] = hora.split(':').map(Number);
      if (isNaN(day) || isNaN(month) || isNaN(year) || isNaN(h) || isNaN(m)) return null;
      const date = new Date(year, month - 1, day, h, m, s || 0);
      return isValid(date) ? date : null;
    } catch {
      return null;
    }
  };

  const ticketsDetalhadosFiltrados = useMemo(() => {
    const dataInicialFiltro = filters.data_inicial ? parseDataPesquisa(filters.data_inicial) : null;
    const dataFinalFiltro = filters.data_final ? parseDataPesquisa(filters.data_final) : null;
    const inicio = dataInicialFiltro ? startOfDay(dataInicialFiltro) : null;
    const fim = dataFinalFiltro ? endOfDay(dataFinalFiltro) : null;

    return ticketsDetalhados.filter((ticket) => {
      if (ticket.ticket_excluido === 'Sim') return false;

      const dataCriacao = parseDataHoraCSV(ticket.data_criacao, ticket.hora_criacao);
      if (!dataCriacao) return false;
      if (inicio && dataCriacao < inicio) return false;
      if (fim && dataCriacao > fim) return false;
      return true;
    });
  }, [ticketsDetalhados, filters.data_inicial, filters.data_final]);

  // O Milvus já calcula estes tempos conforme expediente, pausas e regras do SLA.
  // A mesma amostra é usada no resumo e nos rankings, sem teto artificial.
  const temposDoRelatorio = useMemo(() => {
    const resposta = calculateSlaTimeAverage(
      ticketsDetalhadosFiltrados,
      'tempo_gasto_sla_resposta',
    );
    const solucao = calculateSlaTimeAverage(
      ticketsDetalhadosFiltrados,
      'tempo_gasto_sla_solucao',
    );

    return {
      tempoMedioAbertura: resposta.mediaMinutos,
      tempoMedioSolucao: solucao.mediaMinutos,
      totalResposta: resposta.amostras,
      totalSolucao: solucao.amostras,
    };
  }, [ticketsDetalhadosFiltrados]);

  // ========== MÉTRICAS SLA NATIVAS DO MILVUS (mais precisas) ==========
  // Usa os campos status_sla_resposta e status_sla_solucao que já vêm calculados
  // pelo Milvus considerando expediente, pausas e configurações do sistema
  const metricasSLAMilvus = useMemo(() => {
    if (!ticketsDetalhadosFiltrados.length) {
      return {
        respostaEmDia: 0,
        respostaEstourada: 0,
        solucaoEmDia: 0,
        solucaoEstourada: 0,
        totalComSLAResposta: 0,
        totalComSLASolucao: 0,
      };
    }

    let respostaEmDia = 0;
    let respostaEstourada = 0;
    let solucaoEmDia = 0;
    let solucaoEstourada = 0;
    let totalComSLAResposta = 0;
    let totalComSLASolucao = 0;

    ticketsDetalhadosFiltrados.forEach((t) => {
      // Analisar SLA de Resposta (campo nativo do Milvus)
      if (
        parseSlaDurationMinutes(t.tempo_gasto_sla_resposta) !== null &&
        t.status_sla_resposta &&
        t.status_sla_resposta !== 'Não possui'
      ) {
        totalComSLAResposta++;
        const statusLower = t.status_sla_resposta.toLowerCase();
        // Valores possíveis: "Em conformidade", "Estourado", "Não possui"
        if (statusLower.includes('conformidade') || statusLower.includes('dentro') || statusLower.includes('em dia') || statusLower === 'ok') {
          respostaEmDia++;
        } else if (statusLower.includes('estourado') || statusLower.includes('fora') || statusLower.includes('expir')) {
          respostaEstourada++;
        }
      }

      // Analisar SLA de Solução (campo nativo do Milvus)
      if (
        parseSlaDurationMinutes(t.tempo_gasto_sla_solucao) !== null &&
        t.status_sla_solucao &&
        t.status_sla_solucao !== 'Não possui'
      ) {
        totalComSLASolucao++;
        const statusLower = t.status_sla_solucao.toLowerCase();
        if (statusLower.includes('conformidade') || statusLower.includes('dentro') || statusLower.includes('em dia') || statusLower === 'ok') {
          solucaoEmDia++;
        } else if (statusLower.includes('estourado') || statusLower.includes('fora') || statusLower.includes('expir')) {
          solucaoEstourada++;
        }
      }
    });

    return {
      respostaEmDia,
      respostaEstourada,
      solucaoEmDia,
      solucaoEstourada,
      totalComSLAResposta,
      totalComSLASolucao,
    };
  }, [ticketsDetalhadosFiltrados]);
  // ========== FIM MÉTRICAS SLA MILVUS ==========

  const tempoRespostaPorOperadorCSV = useMemo(() => {
    return calculateSlaTimeByOperator(
      ticketsDetalhadosFiltrados,
      'tempo_gasto_sla_resposta',
    ).map(({ nome, mediaMinutos }) => ({ nome, tempoMedioMinutos: mediaMinutos }));
  }, [ticketsDetalhadosFiltrados]);

  const tempoAtendimentoPorOperadorCSV = useMemo(() => {
    return calculateSlaTimeByOperator(
      ticketsDetalhadosFiltrados,
      'tempo_gasto_sla_solucao',
    ).map(({ nome, mediaMinutos }) => ({
      nome,
      tempoMedioAtendimentoMinutos: mediaMinutos,
    }));
  }, [ticketsDetalhadosFiltrados]);

  const metasSla = useMemo(() => ({
    respostaMinutos: META_RESPOSTA_MINUTOS,
    solucaoMinutos: getPredominantSlaTarget(
      ticketsDetalhadosFiltrados,
      'total_sla_solucao',
      META_ATENDIMENTO_HORAS * 60,
    ),
  }), [ticketsDetalhadosFiltrados]);
  // ========== END RELATÓRIO DE TICKETS ==========

  type OpenTicketAlertData = {
    codigo: number;
    assunto: string;
    nome_fantasia?: string;
    data_criacao?: string;
    status?: string | { text?: string };
    mesa_trabalho?: string | { text?: string };
    nome?: string;
    chatbotWaiting?: boolean;
  };

  type OpenTicketLifecycleEvent = {
    type: 'novo_chamado' | 'chamado_atribuido';
    ticket: OpenTicketAlertData;
  };

  const enqueueOpenTicketLifecycleEvent = ({ type, ticket }: OpenTicketLifecycleEvent) => {
    if (type === 'novo_chamado') {
      notificationStore.add('novo_chamado', {
        codigo: ticket.codigo,
        assunto: ticket.assunto,
        nome_fantasia: ticket.nome_fantasia,
        data_criacao: ticket.data_criacao,
        status: typeof ticket.status === 'object' ? ticket.status?.text : ticket.status,
        mesa_trabalho: typeof ticket.mesa_trabalho === 'object' ? ticket.mesa_trabalho?.text : ticket.mesa_trabalho,
        nome: ticket.nome,
        chatbotWaiting: ticket.chatbotWaiting,
      });
      return;
    }

    notificationStore.add('chamado_atribuido', {
      codigo: ticket.codigo,
      assunto: ticket.assunto,
      nome: ticket.nome,
      nome_fantasia: ticket.nome_fantasia,
    });
  };

  const processOpenTicketEvents = (openTickets: any[], enqueueNotifications = true) => {
    const wasInitialized = openTicketsInitializedRef.current;
    const seenIds = previousOpenTicketIdsRef.current;
    const previousTecnicos = previousTicketTecnicosRef.current;
    const novosChamados: OpenTicketAlertData[] = [];
    const chamadosAtribuidos: OpenTicketAlertData[] = [];
    const orderedEvents: OpenTicketLifecycleEvent[] = [];

    cacheOpenTicketContexts(openTickets);

    if (wasInitialized) {
      openTickets.forEach((ticket) => {
        const codigo = Number(ticket.codigo || ticket.id);
        if (!Number.isFinite(codigo)) return;

        const tecnicoAtual = resolveTicketOperator(ticket);
        const chatbotWaiting = isChatbotIntegrationTicket(ticket, tecnicoAtual) &&
          (!tecnicoAtual || isChatbotOperatorName(tecnicoAtual));
        const tecnicoAnterior = String(previousTecnicos.get(codigo) || '').trim();
        const isNewTicket = !seenIds.has(codigo);
        const eventData: OpenTicketAlertData = {
          codigo,
          assunto: ticket.assunto || 'Sem assunto',
          nome_fantasia: ticket.nome_fantasia || ticket.cliente || '',
          data_criacao: ticket.data_criacao || ticket.data_abertura || new Date().toISOString(),
          status: ticket.status || { text: 'Aberto' },
          mesa_trabalho: ticket.mesa_trabalho || { text: 'Suporte' },
          nome: tecnicoAtual || 'Não atribuído',
          chatbotWaiting,
        };

        if (isNewTicket) {
          console.log('🆕 NOVO CHAMADO DETECTADO:', codigo, eventData.assunto);
          novosChamados.push(eventData);
          orderedEvents.push({ type: 'novo_chamado', ticket: eventData });
        }

        if (
          tecnicoAtual &&
          !isChatbotOperatorName(tecnicoAtual) &&
          tecnicoAtual !== 'Não atribuído' &&
          (isNewTicket || !tecnicoAnterior || tecnicoAnterior === 'Não atribuído' || isChatbotOperatorName(tecnicoAnterior))
        ) {
          console.log('🙋 OPERADOR PEGOU CHAMADO:', codigo, '→', tecnicoAtual);
          chamadosAtribuidos.push(eventData);
          orderedEvents.push({ type: 'chamado_atribuido', ticket: eventData });
        }
      });
    } else {
      openTicketsInitializedRef.current = true;
      console.log('📋 Primeira execução - inicializando baseline de chamados abertos');
    }

    // Abertura sempre entra antes da atribuição detectada no mesmo polling.
    if (novosChamados.length > 0) {
      newTicketsStore.addTickets(novosChamados.map((ticket) => ({
        ...ticket,
        status: typeof ticket.status === 'object'
          ? { text: ticket.status?.text || 'Aberto' }
          : { text: ticket.status || 'Aberto' },
        mesa_trabalho: typeof ticket.mesa_trabalho === 'object'
          ? { text: ticket.mesa_trabalho?.text || 'Suporte' }
          : { text: ticket.mesa_trabalho || 'Suporte' },
      })));
    }

    novosChamados.forEach((ticket) => {
      const tecnico = String(ticket.nome || '').trim();
      if ((tecnico && tecnico !== 'Não atribuído' && !isChatbotOperatorName(tecnico)) || slaTimersRef.current.has(ticket.codigo)) return;

      const { codigo, assunto } = ticket;
      const cliente = ticket.nome_fantasia || 'Desconhecido';
      const avisoTimer = setTimeout(() => {
        if (!slaTimersRef.current.has(codigo)) return;
        notificationStore.add('sla_aviso', {
          codigo,
          assunto,
          nome_fantasia: cliente,
          minutos: 4,
        });
      }, 4 * 60 * 1000);

      const estouradoTimer = setTimeout(() => {
        if (!slaTimersRef.current.has(codigo)) return;
        notificationStore.add('sla_estourado', {
          codigo,
          assunto,
          nome_fantasia: cliente,
        });
        slaTimersRef.current.delete(codigo);
      }, 5 * 60 * 1000);

      slaTimersRef.current.set(codigo, { avisoTimer, estouradoTimer });
    });

    chamadosAtribuidos.forEach((ticket) => clearSlaTimers(ticket.codigo));
    if (enqueueNotifications) orderedEvents.forEach(enqueueOpenTicketLifecycleEvent);

    const nextSeenIds = new Set(seenIds);
    const nextTecnicos = new Map(previousTecnicos);
    openTickets.forEach((ticket) => {
      const codigo = Number(ticket.codigo || ticket.id);
      if (!Number.isFinite(codigo)) return;
      nextSeenIds.add(codigo);
      nextTecnicos.set(codigo, resolveTicketOperator(ticket));
    });
    previousOpenTicketIdsRef.current = nextSeenIds;
    previousTicketTecnicosRef.current = nextTecnicos;

    return { novosChamados, chamadosAtribuidos, events: orderedEvents };
  };

  type GroupedTicketLifecycleEvent =
    | { kind: 'open'; event: OpenTicketLifecycleEvent }
    | { kind: 'rating'; event: SatisfactionAlertData };

  const ticketGroupKey = (value: string | number) => {
    const normalized = String(value ?? '').trim();
    const numeric = Number(normalized);
    return normalized && Number.isFinite(numeric) ? String(numeric) : normalized;
  };

  const enqueueGroupedTicketLifecycle = (
    openEvents: OpenTicketLifecycleEvent[],
    satisfactionEvents: SatisfactionAlertData[],
  ) => {
    const groupOrder: string[] = [];
    const groups = new Map<string, GroupedTicketLifecycleEvent[]>();

    const append = (key: string, event: GroupedTicketLifecycleEvent) => {
      if (!groups.has(key)) {
        groups.set(key, []);
        groupOrder.push(key);
      }
      groups.get(key)!.push(event);
    };

    openEvents.forEach((event) => {
      append(ticketGroupKey(event.ticket.codigo), { kind: 'open', event });
    });
    satisfactionEvents.forEach((event) => {
      append(ticketGroupKey(event.ticket), { kind: 'rating', event });
    });

    groupOrder.forEach((key) => {
      groups.get(key)?.forEach((groupedEvent) => {
        if (groupedEvent.kind === 'open') {
          enqueueOpenTicketLifecycleEvent(groupedEvent.event);
        } else {
          enqueueSatisfactionNotification(groupedEvent.event);
        }
      });
    });
  };

  // Buscar chamados ativos (Atendendo + Pausado) ao carregar a página
  useEffect(() => {
    if (isFetching || initialOpenTicketsRequestedRef.current) return;
    initialOpenTicketsRequestedRef.current = true;

    const loadChamadosAtivos = async () => {
      const chamados = await fetchOpenTickets();
      if (!chamados) return;
      // Filtrar apenas Atendendo e Pausado
      const ativos = chamados.filter((c: any) =>
        c.status === 'Atendendo' || c.status === 'Pausado'
      );
      setChamadosAtivos(ativos);
      setOpenTicketsCount(ativos.length);
      processOpenTicketEvents(chamados);
    };
    void loadChamadosAtivos();
  }, [isFetching]);

  useEffect(() => () => {
    slaTimersRef.current.forEach((_, codigo) => clearSlaTimers(codigo));
  }, []);

  // Listener para erros da API do Milvus (500, 502, 503, 504)
  useEffect(() => {
    const handleMilvusApiError = (event: CustomEvent) => {
      const { status, message, endpoint, timestamp } = event.detail;

      console.error(`🚨 Erro da API Milvus detectado: ${status} ${message} [${endpoint}]`);

      // 502 é transitório e não deve ocupar nem falar na fila de chamados.
      if (Number(status) === 502) {
        const now = Date.now();
        if (now - lastMilvus502ToastAtRef.current > 30_000) {
          lastMilvus502ToastAtRef.current = now;
          toast({
            title: "MILVUS temporariamente indisponível",
            description: "A atualização será tentada novamente sem interromper os avisos de chamados.",
            variant: "destructive",
          });
        }
        return;
      }

      notificationStore.add('erro_milvus', {
        status,
        message,
        endpoint,
        timestamp,
      });
    };

    // Adicionar listener
    window.addEventListener('milvus-api-error', handleMilvusApiError as EventListener);

    // Cleanup
    return () => {
      window.removeEventListener('milvus-api-error', handleMilvusApiError as EventListener);
    };
  }, [toast]);

  // Auto-refresh effect
  useEffect(() => {
    if (!refreshInterval) {
      setNextRefreshIn(null);
      return;
    }

    const intervalMs = refreshInterval;
    let disposed = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    function scheduleNext() {
      if (disposed) return;
      setNextRefreshIn(intervalMs);
      timeoutId = setTimeout(() => void runRefresh(), intervalMs);
    }

    async function runRefresh() {
      if (disposed) return;

      if (document.visibilityState !== "visible" || !navigator.onLine) {
        scheduleNext();
        return;
      }

      if (refreshInFlightRef.current) {
        scheduleNext();
        return;
      }

      refreshInFlightRef.current = true;
      setIsRefreshing(true);
      console.log('Auto-refresh: atualizando dados...');

      let refreshSucceeded = false;

      try {

      // 1. Buscar dados de atendimento (existente)
      const result = await refetch();
      if (result.error) throw result.error;
      const newTickets = result.data?.lista || [];
      const newTicketCount = newTickets.length;

      // 2. Buscar chamados abertos e publicar abertura antes de atribuição.
      const openTickets = await fetchOpenTickets();
      if (!openTickets) throw new Error('Falha ao consultar chamados abertos');
      console.log('📋 Chamados abertos recebidos:', openTickets.length);

      // Atualizar chamados ativos (Atendendo + Pausado) para exibição na Visão Geral
      const ativos = openTickets.filter((c: any) =>
        c.status === 'Atendendo' || c.status === 'Pausado'
      );
      setChamadosAtivos(ativos);
      setOpenTicketsCount(ativos.length);

      const openEventResult = processOpenTicketEvents(openTickets, false);
      const { novosChamados, chamadosAtribuidos } = openEventResult;

      // Junta abertura, atribuição e avaliação por chamado antes de publicar na FIFO.
      const pesquisaResult = await fetchPesquisas(true, false);
      enqueueGroupedTicketLifecycle(openEventResult.events, pesquisaResult?.events ?? []);
      const [reportResult, finalizedResult] = await Promise.all([
        fetchRelatorioTickets(),
        fetchFinalizedTickets(),
      ]);

      if (
        novosChamados.length === 0 &&
        chamadosAtribuidos.length === 0 &&
        pesquisaResult?.notifications === 0 &&
        reportResult?.notifications === 0 &&
        finalizedResult?.notifications === 0
      ) {
        toast({
          title: "Dados atualizados",
          description: `Dashboard atualizado. ${openTickets.length} chamados abertos`,
          duration: 2000,
        });
      }

        setPreviousTicketCount(newTicketCount);
        refreshSucceeded = true;
      } catch (refreshError) {
        console.error("Falha ao atualizar o dashboard:", refreshError);
        if (canPresentRealtimeAlert()) {
          toast({
            title: "Atualização interrompida",
            description: "Não foi possível concluir esta rodada. Uma nova tentativa será feita automaticamente.",
            variant: "destructive",
          });
        }
      } finally {
        refreshInFlightRef.current = false;
        setIsRefreshing(false);
        if (refreshSucceeded) setLastUpdatedAt(new Date());
        scheduleNext();
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible" || refreshInFlightRef.current) return;
      if (timeoutId) clearTimeout(timeoutId);
      scheduleNext();
    };

    scheduleNext();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      if (timeoutId) clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    refreshInterval,
    refetch,
    toast,
    previousTicketCount,
    isManagement,
    refreshScheduleVersion,
    filters.data_inicial,
    filters.data_final,
  ]);

  // Countdown timer
  useEffect(() => {
    if (!nextRefreshIn || nextRefreshIn <= 0) return;

    const countdownId = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setNextRefreshIn((prev) => {
        if (!prev || prev <= 1000) return null;
        return prev - 1000;
      });
    }, 1000);

    return () => clearInterval(countdownId);
  }, [nextRefreshIn]);

  const tickets = ticketsResponse?.lista ?? [];

  useEffect(() => {
    if (ticketsResponse && !isFetching) {
      setLastUpdatedAt((current) => current ?? new Date());
    }
  }, [ticketsResponse, isFetching]);

  // Atualiza a contagem inicial de tickets.
  useEffect(() => {
    if (tickets.length > 0 && previousTicketCount === null) {
      setPreviousTicketCount(tickets.length);
    }
  }, [tickets, previousTicketCount]);

  const dataInicialDate = useMemo(
    () => (filters.data_inicial ? parseDateSafely(filters.data_inicial) : null),
    [filters.data_inicial]
  );
  const dataFinalDate = useMemo(
    () => (filters.data_final ? parseDateSafely(filters.data_final) : null),
    [filters.data_final]
  );

  const ticketsFiltrados = useMemo(() => {
    if (!tickets.length) return [];

    const dedupKey = (ticket: typeof tickets[0]) =>
      ticket.codigo ?? ticket.id ?? `${ticket.id}-${ticket.codigo}`;

    const dentroDoPeriodo = tickets.filter((ticket) => {
      const dataRef = ticket.data_criacao || ticket.data_inicial || ticket.data_final;
      const dataTicket = parseDateSafely(dataRef);
      if (dataInicialDate && dataTicket && dataTicket < dataInicialDate) return false;
      if (dataFinalDate && dataTicket && dataTicket > dataFinalDate) return false;
      return true;
    });

    // Deduplicacao apos o filtro de data para manter apenas chamados do intervalo selecionado.
    // Quando existem multiplos registros do mesmo codigo, mantemos o mais recente.
    const map = new Map<number | string, typeof tickets[0]>();
    dentroDoPeriodo.forEach((t) => {
      const key = dedupKey(t);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, t);
        return;
      }

      const refDate = (ticket: typeof tickets[0]) =>
        parseDateSafely(ticket.data_final) ||
        parseDateSafely(ticket.data_inicial) ||
        parseDateSafely(ticket.data_criacao);

      const newDate = refDate(t)?.getTime() || -Infinity;
      const oldDate = refDate(existing)?.getTime() || -Infinity;

      if (newDate >= oldDate) {
        map.set(key, t);
      }
    });

    return Array.from(map.values());
  }, [tickets, dataInicialDate, dataFinalDate]);

  const aggregatedData = useMemo(() => {
    if (!ticketsFiltrados.length) return null;
    return aggregateTicketData(ticketsFiltrados);
  }, [ticketsFiltrados]);

  const slaData = useMemo(() => {
    if (!ticketsFiltrados.length) return null;
    return calculateSLADistribution(ticketsFiltrados);
  }, [ticketsFiltrados]);

  const periodoDias = useMemo(
    () => parseDateRangeDias(filters.data_inicial, filters.data_final),
    [filters.data_inicial, filters.data_final]
  );

  // A API principal já respeita o período selecionado. Ela é a fonte mais
  // confiável para os indicadores operacionais porque o relatório personalizado
  // do Milvus pode vir limitado ou com um recorte histórico desatualizado.
  const chamadosPorDia = useMemo(() => {
    const map = new Map<string, number>();

    ticketsFiltrados.forEach((ticket) => {
      const dataSolucao = parseDateSafely(ticket.data_solucao);
      if (!dataSolucao) return;

      const dateKey = format(dataSolucao, 'yyyy-MM-dd');
      map.set(dateKey, (map.get(dateKey) || 0) + 1);
    });

    return map;
  }, [ticketsFiltrados]);

  // Gerar dados do calendário para o mês atual baseado no período selecionado
  const calendarioData = useMemo(() => {
    const dataInicio = dataInicialDate || new Date();
    const dataFim = dataFinalDate || new Date();

    // Pegar o primeiro dia do mês de início
    const primeiroDiaMes = new Date(dataInicio.getFullYear(), dataInicio.getMonth(), 1);
    const ultimoDiaMes = new Date(dataInicio.getFullYear(), dataInicio.getMonth() + 1, 0);

    // Calcular qual dia da semana é o primeiro dia do mês (0 = Domingo, 6 = Sábado)
    const primeiroDiaSemana = primeiroDiaMes.getDay();

    // Criar array de semanas
    const semanas: Array<Array<{ dia: number | null; quantidade: number; data: Date | null }>> = [];
    let semanaAtual: Array<{ dia: number | null; quantidade: number; data: Date | null }> = [];

    // Preencher dias vazios antes do primeiro dia do mês
    for (let i = 0; i < primeiroDiaSemana; i++) {
      semanaAtual.push({ dia: null, quantidade: 0, data: null });
    }

    // Preencher os dias do mês
    for (let dia = 1; dia <= ultimoDiaMes.getDate(); dia++) {
      const dataAtual = new Date(dataInicio.getFullYear(), dataInicio.getMonth(), dia);
      const dateKey = format(dataAtual, 'yyyy-MM-dd');
      const quantidade = chamadosPorDia.get(dateKey) || 0;

      semanaAtual.push({ dia, quantidade, data: dataAtual });

      // Se chegou no sábado ou é o último dia, começa nova semana
      if (semanaAtual.length === 7) {
        semanas.push(semanaAtual);
        semanaAtual = [];
      }
    }

    // Preencher dias vazios após o último dia do mês
    if (semanaAtual.length > 0) {
      while (semanaAtual.length < 7) {
        semanaAtual.push({ dia: null, quantidade: 0, data: null });
      }
      semanas.push(semanaAtual);
    }

    return {
      mes: format(dataInicio, 'MMMM yyyy', { locale: ptBR }),
      semanas,
    };
  }, [dataInicialDate, dataFinalDate, chamadosPorDia]);

  // Atividade por operador por dia da semana (Dom, Seg, Ter, Qua, Qui, Sex, Sáb)
  const atividadePorOperadorDiaSemana = useMemo(() => {
    if (!ticketsFiltrados.length) return [];

    // Map: operador -> [dom, seg, ter, qua, qui, sex, sab]
    const map = new Map<string, number[]>();

    ticketsFiltrados.forEach((ticket) => {
      const dataSolucao = parseDateSafely(ticket.data_solucao);
      if (!dataSolucao) return;

      const operador = resolveTicketOperator(ticket) || 'Não atribuído';
      const diaSemana = dataSolucao.getDay(); // 0 = Domingo, 6 = Sábado

      if (!map.has(operador)) {
        map.set(operador, [0, 0, 0, 0, 0, 0, 0]);
      }
      const dias = map.get(operador)!;
      dias[diaSemana] += 1;
    });

    // Converter para array ordenado por total de chamados
    return Array.from(map.entries())
      .map(([operador, dias]) => ({
        operador,
        dias,
        total: dias.reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => b.total - a.total);
  }, [ticketsFiltrados]);

  const conformidadePercentual =
    slaData && tickets.length
      ? (slaData.emDia / (slaData.emDia + slaData.emRisco + slaData.estourado)) * 100
      : 0;

  const mediaEstimadaNotas = Number(((conformidadePercentual / 100) * 5).toFixed(1));

  // Indicadores de SLA nunca usam diferença de relógio como contingência:
  // isso incluiria noites, fins de semana e pausas e inflaria os resultados.
  const temposExibicao = {
    tempoMedioAbertura: temposDoRelatorio.tempoMedioAbertura,
    tempoMedioSolucao: temposDoRelatorio.tempoMedioSolucao,
  };

  const tempoRespostaExibicao = tempoRespostaPorOperadorCSV;

  const tempoAtendimentoExibicao = tempoAtendimentoPorOperadorCSV;

  const metricasSLAExibicao = {
    respostaEstourada: metricasSLAMilvus.respostaEstourada,
    solucaoEstourada: metricasSLAMilvus.solucaoEstourada,
    totalComSLAResposta: metricasSLAMilvus.totalComSLAResposta,
    totalComSLASolucao: metricasSLAMilvus.totalComSLASolucao,
  };

  const rankingOperadores = useMemo(() => {
    if (!ticketsFiltrados.length) return [];
    const map = new Map<string, number>();
    ticketsFiltrados.forEach((ticket) => {
      const nome = ticket.nome || "Sem nome";
      map.set(nome, (map.get(nome) || 0) + 1);
    });
    const periodoDias = parseDateRangeDias(filters.data_inicial, filters.data_final);
    return Array.from(map.entries())
      .map(([nome, total]) => ({
        nome,
        total,
        mediaDiaria: periodoDias > 0 ? total / periodoDias : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [ticketsFiltrados, filters.data_inicial, filters.data_final]);

  // Função para obter indicador de mudança de posição (comparando com início do dia)
  const getPositionChange = (nome: string, currentPosition: number): 'up' | 'down' | 'same' | 'new' => {
    // Se ainda não há ranking de referência do início do dia, todos ficam com "-"
    if (startOfDayRanking.size === 0) {
      return 'same';
    }

    const startPosition = startOfDayRanking.get(nome);
    if (startPosition === undefined) {
      return 'new'; // Operador novo (não estava no início do dia)
    }

    if (startPosition > currentPosition) {
      return 'up'; // Subiu desde o início do dia
    } else if (startPosition < currentPosition) {
      return 'down'; // Desceu desde o início do dia
    }
    return 'same'; // Mesma posição do início do dia
  };

  // Salvar ranking de referência do início do dia (apenas uma vez por dia)
  useEffect(() => {
    if (rankingOperadores.length > 0) {
      const today = format(new Date(), 'yyyy-MM-dd');

      // Verificar se já salvou o ranking de referência hoje
      const savedData = localStorage.getItem('dashboard-start-of-day-ranking');
      let alreadySavedToday = false;

      if (savedData) {
        try {
          const { date } = JSON.parse(savedData);
          alreadySavedToday = date === today;
        } catch { }
      }

      // Se é a primeira vez hoje, salvar como ranking de referência do dia
      if (!alreadySavedToday) {
        const newRanking = new Map<string, number>();
        rankingOperadores.forEach((op, idx) => {
          newRanking.set(op.nome, idx);
        });

        // Salvar no localStorage
        const data = {
          date: today,
          ranking: Object.fromEntries(newRanking),
        };
        localStorage.setItem('dashboard-start-of-day-ranking', JSON.stringify(data));

        // Atualizar state
        setStartOfDayRanking(newRanking);

        console.log('📊 Ranking de referência do dia salvo:', Object.fromEntries(newRanking));
      }

      rankingInitializedRef.current = true;
    }
  }, [rankingOperadores]);

  // Ranking de operadores baseado APENAS em chamados ativos (Atendendo + Pausado)
  const rankingChamadosAtivos = useMemo(() => {
    if (!chamadosAtivos.length) return [];
    const map = new Map<string, { atendendo: number; pausado: number; total: number }>();

    chamadosAtivos.forEach((ticket: any) => {
      const nome = resolveTicketOperator(ticket) || "Não atribuído";
      if (!map.has(nome)) {
        map.set(nome, { atendendo: 0, pausado: 0, total: 0 });
      }
      const data = map.get(nome)!;
      data.total += 1;
      if (ticket.status === 'Atendendo') {
        data.atendendo += 1;
      } else if (ticket.status === 'Pausado') {
        data.pausado += 1;
      }
    });

    return Array.from(map.entries())
      .map(([nome, data]) => ({
        nome,
        atendendo: data.atendendo,
        pausado: data.pausado,
        total: data.total,
      }))
      .sort((a, b) => b.total - a.total);
  }, [chamadosAtivos]);

  const handleDateChange = (type: "start" | "end", value: string) => {
    if (!value) {
      updateFilters({
        [type === "start" ? "data_inicial" : "data_final"]: undefined,
      });
      return;
    }

    const parsed = parseISO(value);
    if (!isValid(parsed)) return;

    if (type === "start") {
      updateFilters({ data_inicial: format(startOfDay(parsed), "yyyy-MM-dd HH:mm:ss") });
    } else {
      updateFilters({ data_final: format(endOfDay(parsed), "yyyy-MM-dd HH:mm:ss") });
    }
  };

  const handleRefreshChange = (value: string) => {
    if (isManagement) return;

    if (value === "off") {
      setRefreshInterval(null);
      localStorage.removeItem('dashboard-refresh-interval');
    } else {
      const numValue = parseInt(value, 10);
      setRefreshInterval(numValue);
      localStorage.setItem('dashboard-refresh-interval', value);
    }
  };

  const handleManualRefresh = async () => {
    if (refreshInFlightRef.current) return;

    if (!navigator.onLine) {
      toast({
        title: "Sem conexão",
        description: "A atualização será retomada quando a rede voltar.",
        variant: "destructive",
      });
      return;
    }

    refreshInFlightRef.current = true;
    setIsRefreshing(true);

    try {

    // 1. Atualizar dados do relatório
    const result = await refetch();
    if (result.error) throw result.error;
    const newTicketCount = result.data?.lista?.length || 0;

    const openTickets = await fetchOpenTickets();
    if (!openTickets) throw new Error('Falha ao consultar chamados abertos');

    const ativos = openTickets.filter((c: any) =>
      c.status === 'Atendendo' || c.status === 'Pausado'
    );
    setChamadosAtivos(ativos);
    setOpenTicketsCount(ativos.length);

    const openEventResult = processOpenTicketEvents(openTickets, false);
    const { novosChamados, chamadosAtribuidos } = openEventResult;
    const pesquisaResult = await fetchPesquisas(true, false);
    enqueueGroupedTicketLifecycle(openEventResult.events, pesquisaResult?.events ?? []);
    const [reportResult, finalizedResult] = await Promise.all([
      fetchRelatorioTickets(),
      fetchFinalizedTickets(),
    ]);

    if (
      novosChamados.length === 0 &&
      chamadosAtribuidos.length === 0 &&
      pesquisaResult?.notifications === 0 &&
      reportResult?.notifications === 0 &&
      finalizedResult?.notifications === 0
    ) {
      toast({
        title: "Dados atualizados",
        description: `Dashboard atualizado • ${ativos.length} chamado(s) ativo(s)`,
        duration: 2000,
      });
    }

      setPreviousTicketCount(newTicketCount);
      setLastUpdatedAt(new Date());
      setRefreshScheduleVersion((current) => current + 1);

      // Reseta o countdown se houver refresh automático ativo
      if (refreshInterval) {
        setNextRefreshIn(refreshInterval);
      }
    } catch (refreshError) {
      console.error("Falha na atualização manual:", refreshError);
      toast({
        title: "Falha na atualização",
        description: "Não foi possível carregar todos os indicadores. Tente novamente.",
        variant: "destructive",
      });
    } finally {
      refreshInFlightRef.current = false;
      setIsRefreshing(false);
    }
  };

  const dataInicialDateInput = useMemo(
    () => (filters.data_inicial ? parseDateSafely(filters.data_inicial) : null),
    [filters.data_inicial]
  );
  const dataFinalDateInput = useMemo(
    () => (filters.data_final ? parseDateSafely(filters.data_final) : null),
    [filters.data_final]
  );

  // Estado para o DateRangePicker
  const dateRange = useMemo((): DateRange | undefined => {
    const from = dataInicialDateInput ?? undefined;
    const to = dataFinalDateInput ?? undefined;
    if (!from && !to) return undefined;
    return { from, to };
  }, [dataInicialDateInput, dataFinalDateInput]);

  const handleDateRangeChange = (range: DateRange | undefined) => {
    if (!range) {
      updateFilters({ data_inicial: undefined, data_final: undefined });
      return;
    }
    updateFilters({
      data_inicial: range.from ? format(startOfDay(range.from), "yyyy-MM-dd HH:mm:ss") : undefined,
      data_final: range.to ? format(endOfDay(range.to), "yyyy-MM-dd HH:mm:ss") : undefined,
    });
  };

  if (isLoading) {
    if (isManagement) {
      return (
        <div
          className="grid min-h-full min-w-0 content-start gap-2.5 pb-4 xl:h-full xl:min-h-0 xl:grid-rows-[13fr_12fr_39fr_36fr] xl:gap-1.5 xl:pb-0 [@media(max-height:719px)]:xl:min-h-[600px]"
          role="status"
          aria-label="Carregando sala de gestão"
        >
          <div className="grid min-w-0 gap-2.5 lg:grid-cols-[2fr_1fr] xl:grid-cols-[64fr_36fr] xl:gap-1.5">
            <Skeleton className="min-h-24 rounded-2xl xl:min-h-0" />
            <Skeleton className="min-h-24 rounded-2xl xl:min-h-0" />
          </div>

          <div className="grid min-w-0 gap-2.5 sm:grid-cols-2 lg:grid-cols-10 xl:grid-cols-[11fr_11fr_11fr_11fr_11fr_22.5fr_22.5fr] xl:gap-1.5">
            {Array.from({ length: 7 }).map((_, index) => (
              <Skeleton
                key={index}
                className={cn(
                  "min-h-20 rounded-2xl xl:col-span-1 xl:min-h-0",
                  index < 5 ? "lg:col-span-2" : "lg:col-span-5",
                )}
              />
            ))}
          </div>

          <div className="grid min-w-0 gap-2.5 lg:grid-cols-[68fr_32fr] xl:gap-1.5">
            <Skeleton className="min-h-64 rounded-2xl xl:min-h-0" />
            <Skeleton className="min-h-64 rounded-2xl xl:min-h-0" />
          </div>

          <div className="grid min-w-0 gap-2.5 sm:grid-cols-2 xl:gap-1.5">
            <Skeleton className="min-h-56 rounded-2xl xl:min-h-0" />
            <Skeleton className="min-h-56 rounded-2xl xl:min-h-0" />
          </div>

          <span className="sr-only">Carregando indicadores em tempo real...</span>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <PageHeader
          titulo="Visão Geral"
          subtitulo="Dashboard executivo com indicadores principais"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    if (isManagement) {
      return (
        <div className="flex h-full min-h-[520px] items-center justify-center px-4">
          <Card className="w-full max-w-xl border-rose-500/20 bg-slate-950/75 shadow-2xl">
            <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-rose-500/10 text-rose-300">
                <AlertTriangle aria-hidden="true" />
              </div>
              <div>
                <h2 className="font-semibold text-slate-100">Sala temporariamente indisponível</h2>
                <p className="mt-1 text-sm text-slate-400">
                  {error instanceof Error ? error.message : "Verifique a conexão e tente novamente."}
                </p>
              </div>
              <Button variant="outline" onClick={handleManualRefresh} disabled={isRefreshing || isFetching}>
                <RefreshCw className={cn((isRefreshing || isFetching) && "animate-spin")} aria-hidden="true" />
                Tentar novamente
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <PageHeader
          titulo="Visão Geral"
          subtitulo="Dashboard executivo com indicadores principais"
        />
        <Card className="border-destructive/25 bg-destructive/[0.04]">
          <CardContent className="flex flex-col items-start gap-4 py-8 sm:flex-row sm:items-center">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <AlertTriangle aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">Não foi possível atualizar a visão geral</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {error instanceof Error ? error.message : "Verifique a conexão e tente novamente."}
              </p>
            </div>
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn(isFetching && "animate-spin")} aria-hidden="true" />
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!aggregatedData || !slaData) {
    if (isManagement) {
      return (
        <div className="flex h-full min-h-[520px] items-center justify-center px-4">
          <Card className="w-full max-w-xl border-slate-700/70 bg-slate-950/75 shadow-2xl">
            <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-sky-500/10 text-sky-300">
                <Activity aria-hidden="true" />
              </div>
              <div>
                <h2 className="font-semibold text-slate-100">Nenhum dado no período monitorado</h2>
                <p className="mt-1 text-sm text-slate-400">Volte ao dashboard para ajustar os filtros ou atualize a sala.</p>
              </div>
              <Button variant="outline" onClick={handleManualRefresh} disabled={isRefreshing}>
                <RefreshCw className={cn(isRefreshing && "animate-spin")} aria-hidden="true" />
                Atualizar agora
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <PageHeader
          titulo="Visão Geral"
          subtitulo="Nenhum dado disponível para o período selecionado"
        />
        {/* Filtro de datas para permitir ajuste mesmo sem dados */}
        <Card className="border-dashed">
          <CardContent className="py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4 sm:flex-wrap">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase text-muted-foreground">Período</span>
                <DateRangePicker
                  dateRange={dateRange}
                  onDateRangeChange={handleDateRangeChange}
                />
              </div>
              <Button onClick={handleManualRefresh} variant="outline" size="sm" disabled={isRefreshing}>
                {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Atualizar
              </Button>
            </div>
          </CardContent>
        </Card>
        <p className="text-sm text-muted-foreground text-center py-8">
          Selecione um período de datas acima para carregar os dados do dashboard.
        </p>
      </div>
    );
  }

  const respostasDentroSla = Math.max(
    0,
    metricasSLAExibicao.totalComSLAResposta - metricasSLAExibicao.respostaEstourada,
  );
  const solucoesDentroSla = Math.max(
    0,
    metricasSLAExibicao.totalComSLASolucao - metricasSLAExibicao.solucaoEstourada,
  );
  const ticketsFinalizadosNativos = ticketsDetalhadosFiltrados.filter((ticket) =>
    isTicketFinished(ticket.status)
  ).length;
  const ticketsFinalizadosExibicao = ticketsDetalhadosFiltrados.length > 0
    ? ticketsFinalizadosNativos
    : aggregatedData.totalTickets;

  const kpiCards = [
    {
      titulo: "Tickets Finalizados",
      valor: ticketsFinalizadosExibicao.toLocaleString("pt-BR"),
      detalhe: "",
      icon: <Phone className="h-6 w-6 text-emerald-400 icon-glow" />,
      className: "glass glow-emerald",
      valueColor: "text-emerald-400",
    },
    {
      titulo: "Qtd Resposta em Dia",
      valor: respostasDentroSla.toLocaleString("pt-BR"),
      detalhe: metricasSLAExibicao.totalComSLAResposta
        ? `${((respostasDentroSla / metricasSLAExibicao.totalComSLAResposta) * 100).toFixed(1)}%`
        : "0%",
      icon: <Timer className="h-6 w-6 text-sky-400 icon-glow" />,
      className: "glass glow-blue",
      valueColor: "text-sky-400",
    },
    {
      titulo: "Qtd Atendimento em Dia",
      valor: solucoesDentroSla.toLocaleString("pt-BR"),
      detalhe: metricasSLAExibicao.totalComSLASolucao
        ? `${((solucoesDentroSla / metricasSLAExibicao.totalComSLASolucao) * 100).toFixed(1)}%`
        : "0%",
      icon: <Clock4 className="h-6 w-6 text-emerald-400 icon-glow" />,
      className: "glass glow-emerald",
      valueColor: "text-emerald-400",
    },
    {
      titulo: "Qtd Resposta Estourada",
      valor: metricasSLAExibicao.respostaEstourada.toLocaleString("pt-BR"),
      detalhe: metricasSLAExibicao.totalComSLAResposta
        ? `${((metricasSLAExibicao.respostaEstourada / metricasSLAExibicao.totalComSLAResposta) * 100).toFixed(1)}%`
        : "0%",
      icon: <AlertTriangle className="h-6 w-6 text-red-400 icon-glow" />,
      className: "glass glow-red",
      valueColor: "text-red-400",
      link: "/registros-expirados?tab=resposta",
    },
    {
      titulo: "Qtd Atendimento Expirado",
      valor: metricasSLAExibicao.solucaoEstourada.toLocaleString("pt-BR"),
      detalhe: metricasSLAExibicao.totalComSLASolucao
        ? `${((metricasSLAExibicao.solucaoEstourada / metricasSLAExibicao.totalComSLASolucao) * 100).toFixed(1)}%`
        : "0%",
      icon: <AlertTriangle className="h-6 w-6 text-red-400 icon-glow" />,
      className: "glass glow-red",
      valueColor: "text-red-400",
      link: "/registros-expirados?tab=atendimento",
    },
  ];

  const renderStars = () => {
    const cheias = Math.floor(mediaEstimadaNotas);
    return (
      <div className="flex items-center gap-1">
        {Array.from({ length: 5 }).map((_, idx) => (
          <Star
            key={idx}
            className={cn(
              "h-5 w-5",
              idx < cheias ? "text-amber-400 fill-amber-400" : "text-muted-foreground"
            )}
          />
        ))}
      </div>
    );
  };

  const topOperadores = rankingOperadores.slice(0, 5);

  if (isManagement) {
    return (
      <ManagementDashboard
        rankingPesquisas={rankingPesquisas}
        openTicketsCount={openTicketsCount}
        chamadosAtivos={chamadosAtivos}
        tempoAbertura={formatMinutosCompleto(temposExibicao.tempoMedioAbertura)}
        tempoSolucao={formatMinutosCompleto(temposExibicao.tempoMedioSolucao)}
        metaResposta={formatMinutosCompleto(metasSla.respostaMinutos)}
        metaSolucao={formatMinutosCompleto(metasSla.solucaoMinutos)}
        atividade={atividadePorOperadorDiaSemana}
        calendario={calendarioData}
        kpis={kpiCards}
        tempoResposta={tempoRespostaExibicao}
        tempoAtendimento={tempoAtendimentoExibicao}
        isRefreshing={isRefreshing}
        nextRefreshSeconds={Math.ceil((nextRefreshIn ?? MANAGEMENT_REFRESH_INTERVAL) / 1000)}
        lastUpdatedLabel={lastUpdatedAt ? format(lastUpdatedAt, "HH:mm:ss") : "aguardando"}
        onRefresh={() => void handleManualRefresh()}
        isOnline={isOnline}
        getAvatarSrc={getAvatarSrc}
        formatDuration={formatMinutosCompleto}
      />
    );
  }

  return (
    <div ref={reportRef} className="space-y-6">
      <div className="grid min-w-0 grid-cols-1 gap-4 2xl:grid-cols-12 2xl:items-stretch">
        <div className="flex min-w-0 flex-col gap-3 2xl:contents">
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between 2xl:col-span-12">
            <PageHeader
              titulo="Visão Geral"
              subtitulo="Dashboard executivo inspirado no painel compartilhado"
              className="flex-1"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={exportToPDF}
              disabled={isExporting}
              className="h-9 w-full gap-2 sm:w-auto"
            >
              {isExporting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Exportando...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Exportar PDF
                </>
              )}
            </Button>
          </div>

          {/* Widget Top 3 Pesquisas (abaixo do título) */}
          {rankingPesquisas.length > 0 && (
            <div className="glass glow-amber overflow-hidden rounded-2xl p-1 animate-fade-in 2xl:col-span-8 2xl:h-full">
              <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:gap-6">
                <div className="flex items-center gap-3 border-b border-yellow-500/20 pb-4 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-6">
                  <div className="p-2 rounded-xl bg-yellow-500/20">
                    <Trophy className="h-6 w-6 text-yellow-400 icon-glow" />
                  </div>
                  <div>
                    <span className="text-sm font-bold text-yellow-400 uppercase tracking-wider">Top Avaliados</span>
                    <p className="text-xs text-slate-400">Pesquisa de Satisfação</p>
                  </div>
                </div>
                <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3 lg:flex lg:items-center lg:gap-4">
                  {rankingPesquisas.map((item, idx) => (
                    <div key={item.operador} className={cn(
                      "flex min-w-0 items-center gap-3 rounded-xl p-2.5 transition-all",
                      idx === 0 && "bg-yellow-500/10 shimmer"
                    )}>
                      <div className="relative">
                        <Avatar className={cn(
                          "border-3 shadow-lg",
                          idx === 0 ? "h-16 w-16 ring-4 ring-yellow-500/50 ring-offset-2 ring-offset-slate-900" :
                            idx === 1 ? "h-14 w-14 ring-2 ring-slate-400/50 ring-offset-1 ring-offset-slate-900" :
                              "h-14 w-14 ring-2 ring-amber-700/50 ring-offset-1 ring-offset-slate-900"
                        )}>
                          <AvatarImage src={getAvatarSrc(item.operador)} alt={item.operador} />
                          <AvatarFallback className={cn(
                            "font-bold",
                            idx === 0 ? "bg-gradient-to-br from-yellow-600 to-amber-700 text-yellow-100" :
                              idx === 1 ? "bg-gradient-to-br from-slate-500 to-slate-600 text-slate-100" :
                                "bg-gradient-to-br from-amber-700 to-amber-800 text-amber-100"
                          )}>
                            {item.operador.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className={cn(
                          "absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shadow-lg",
                          idx === 0 ? "bg-yellow-500 text-yellow-950" :
                            idx === 1 ? "bg-slate-400 text-slate-900" :
                              "bg-amber-700 text-amber-100"
                        )}>
                          {idx + 1}º
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className={cn(
                          "font-bold flex items-center gap-2",
                          idx === 0 ? "text-lg text-yellow-300" : "text-base text-slate-200"
                        )}>
                          {idx === 0 && <Trophy className="h-5 w-5 text-yellow-400 fill-yellow-400/30" />}
                          {idx === 1 && <Medal className="h-4 w-4 text-slate-400 fill-slate-400/30" />}
                          {idx === 2 && <Medal className="h-4 w-4 text-amber-600 fill-amber-600/30" />}
                          {item.operador.split(' ')[0]}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "text-2xl font-bold",
                            idx === 0 ? "text-yellow-400" : idx === 1 ? "text-slate-300" : "text-amber-500"
                          )}>
                            {item.quantidade}
                          </span>
                          <span className="text-xs text-slate-400">avaliações</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Card de Chamados Ativos - movido para cá */}
          <div className={cn(
            "glass glow-emerald min-w-0 rounded-2xl px-4 py-4 animate-fade-in-delay-1 sm:px-6 2xl:h-full",
            rankingPesquisas.length > 0 ? "2xl:col-span-4" : "2xl:col-span-12"
          )}>
            <div className="flex h-full flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase text-emerald-400 tracking-wider flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 pulse-ring" />
                  Chamados Ativos
                </span>
                <span className="text-5xl font-bold text-white number-highlight">{openTicketsCount}</span>
              </div>
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex items-center gap-3 bg-emerald-500/20 px-3 py-1.5 rounded-lg">
                  <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-emerald-300 font-medium">{chamadosAtivos.filter((c: any) => c.status === 'Atendendo').length}</span>
                  <span className="text-emerald-400/70 text-xs">atendendo</span>
                </div>
                <div className="flex items-center gap-3 bg-yellow-500/20 px-3 py-1.5 rounded-lg">
                  <span className="w-3 h-3 rounded-full bg-yellow-500" />
                  <span className="text-yellow-300 font-medium">{chamadosAtivos.filter((c: any) => c.status === 'Pausado').length}</span>
                  <span className="text-yellow-400/70 text-xs">pausado</span>
                </div>
              </div>
            </div>
          </div>

          {/* Período + Metas */}
          <div className="glass-subtle rounded-2xl px-4 py-3 animate-fade-in-delay-2 2xl:col-span-12">
            <div className="grid gap-4 md:grid-cols-[minmax(240px,0.7fr)_minmax(0,1.3fr)] md:items-end">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase text-slate-400 tracking-wider">Período</span>
                <DateRangePicker
                  dateRange={dateRange}
                  onDateRangeChange={handleDateRangeChange}
                  placeholder="Selecione o período"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col items-center rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-2">
                  <span className="text-[10px] font-semibold text-blue-400 tracking-wide">META {formatMinutosCompleto(metasSla.respostaMinutos)}</span>
                  <span className="text-xl font-mono font-bold text-blue-300">
                    {formatMinutosCompleto(temposExibicao.tempoMedioAbertura)}
                  </span>
                  <span className="text-[9px] text-slate-400">Tempo médio abertura</span>
                </div>
                <div className="flex flex-col items-center px-4 py-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10">
                  <span className="text-[10px] font-semibold text-emerald-400 tracking-wide">META {formatMinutosCompleto(metasSla.solucaoMinutos)}</span>
                  <span className="text-xl font-mono font-bold text-emerald-300">
                    {formatMinutosCompleto(temposExibicao.tempoMedioSolucao)}
                  </span>
                  <span className="text-[9px] text-slate-400">Tempo médio solução</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-1 items-start gap-3 sm:grid-cols-2 2xl:contents">
          {/* Atividade por Dia da Semana - Por Operador */}
          <Card className="min-w-0 overflow-hidden border-slate-700/50 bg-slate-900/50 2xl:col-span-7 2xl:h-full">
            <CardContent className="py-3 px-4">
              <div className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-2">
                <Activity className="h-4 w-4 text-orange-500" />
                Atividade por Dia da Semana
              </div>
              <div className="scrollbar-subtle overflow-x-auto">
                <table className="min-w-[420px] table-fixed text-xs sm:min-w-0 sm:w-full">
                  <thead className="sticky top-0 bg-slate-900/90 backdrop-blur-sm">
                    <tr>
                      <th className="text-left text-muted-foreground font-medium px-1 py-1 min-w-[80px]">Técnico</th>
                      {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((dia, i) => (
                        <th key={i} className="text-center text-muted-foreground font-normal px-1 py-1 w-8">
                          {dia}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {atividadePorOperadorDiaSemana.map((item, idx) => (
                      <tr key={idx} className="border-t border-slate-800/50">
                        <td className="text-left text-slate-300 font-medium px-1 py-1.5 truncate max-w-[100px]" title={item.operador}>
                          {item.operador.split(' ')[0]}
                        </td>
                        {item.dias.map((qtd, dIdx) => (
                          <td key={dIdx} className="text-center px-0.5 py-1">
                            {qtd > 0 ? (
                              <div
                                className={cn(
                                  "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium mx-auto",
                                  qtd <= 2 && "bg-blue-500 text-white",
                                  qtd > 2 && qtd <= 5 && "bg-blue-600 text-white",
                                  qtd > 5 && "bg-orange-500 text-white font-bold"
                                )}
                                title={`${item.operador}: ${qtd} chamados`}
                              >
                                {qtd}
                              </div>
                            ) : (
                              <span className="text-muted-foreground/40">-</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {atividadePorOperadorDiaSemana.length === 0 && (
                      <tr>
                        <td colSpan={8} className="text-center text-muted-foreground py-4">
                          Sem dados no período
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Coluna: Calendário + Atualização Automática */}
          <div className="flex flex-col gap-2 2xl:col-span-5 2xl:h-full">
            <Card className="min-w-0 border-slate-700/50 bg-slate-900/50">
              <CardContent className="py-3 px-4">
                <div className="text-xs font-semibold uppercase text-muted-foreground mb-1 text-center">
                  Chamados por Dia
                </div>
                <div className="text-[10px] text-muted-foreground/70 mb-2 text-center capitalize">
                  {calendarioData.mes} (Data Solução)
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((dia, i) => (
                        <th key={i} className="text-center text-muted-foreground font-normal px-1 py-1">
                          {dia}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {calendarioData.semanas.map((semana, sIdx) => (
                      <tr key={sIdx}>
                        {semana.map((cell, dIdx) => (
                          <td key={dIdx} className="text-center p-0.5">
                            {cell.dia !== null ? (
                              <div
                                className={cn(
                                  "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium transition-all",
                                  cell.quantidade === 0 && "text-muted-foreground/50",
                                  cell.quantidade > 0 && cell.quantidade <= 5 && "bg-blue-500 text-white",
                                  cell.quantidade > 5 && cell.quantidade <= 10 && "bg-blue-600 text-white",
                                  cell.quantidade > 10 && cell.quantidade <= 20 && "bg-orange-500 text-white",
                                  cell.quantidade > 20 && "bg-orange-600 text-white font-bold"
                                )}
                                title={`${cell.dia}: ${cell.quantidade} chamados`}
                              >
                                {cell.quantidade > 0 ? cell.quantidade : '-'}
                              </div>
                            ) : (
                              <div className="w-6 h-6" />
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* Atualização Automática */}
            <div className="flex flex-col gap-1 px-3 py-2 rounded-lg border border-slate-700/50 bg-slate-900/50">
              <span className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1 justify-center">
                <RefreshCw className={cn("h-3 w-3", isRefreshing && "animate-spin")} />
                Atualização automática
              </span>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Select
                  value={refreshInterval ? String(refreshInterval) : "off"}
                  onValueChange={handleRefreshChange}
                >
                  <SelectTrigger className="w-[100px] h-8 text-xs">
                    <SelectValue placeholder="Desativado" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off">Desativado</SelectItem>
                    {REFRESH_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {nextRefreshIn && nextRefreshIn > 0 && (
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {Math.floor(nextRefreshIn / 1000)}s
                  </span>
                )}
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleManualRefresh}
                  disabled={isRefreshing}
                  className="h-8 w-8"
                  title="Atualizar agora"
                >
                  <RefreshCw className={cn("h-3 w-3", isRefreshing && "animate-spin")} />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    announcementQueue.enqueue({
                      id: `voice-test-${Date.now()}`,
                      text: "Olá a todos! Bem-vindos ao Pólo BI AI.",
                    });
                    toast({
                      title: "🔊 Teste de Áudio",
                      description: "O teste entrou na fila e não interromperá avisos em andamento.",
                      duration: 5000,
                    });
                  }}
                  className="h-8 text-xs px-2"
                  title="Testar notificação por voz"
                >
                  🔊 Testar Voz
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Faixa de KPIs principais */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        {kpiCards.map((card, index) => (
          <Card
            key={card.titulo}
            className={cn(
              "rounded-xl border-0 hover-lift overflow-hidden",
              card.className,
              card.link && "cursor-pointer",
              index === 0 && "animate-fade-in",
              index === 1 && "animate-fade-in-delay-1",
              index === 2 && "animate-fade-in-delay-2",
              index === 3 && "animate-fade-in-delay-3",
              index === 4 && "animate-fade-in-delay-3"
            )}
            onClick={() => card.link && setLocation(card.link)}
            onKeyDown={(event) => {
              if (card.link && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                setLocation(card.link);
              }
            }}
            role={card.link ? "link" : undefined}
            tabIndex={card.link ? 0 : undefined}
            aria-label={card.link ? `${card.titulo}: ${card.valor}. Abrir detalhes` : undefined}
          >
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{card.titulo}</span>
                <div className="p-2 rounded-lg bg-white/5">
                  {card.icon}
                </div>
              </div>
              <div className={cn("text-4xl font-bold leading-none tracking-tight", card.valueColor || "text-white")}>
                {card.valor}
              </div>
              {card.detalhe && (
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all duration-500",
                        card.valueColor?.includes("red") ? "bg-red-500" :
                          card.valueColor?.includes("sky") ? "bg-sky-500" : "bg-emerald-500"
                      )}
                      style={{ width: card.detalhe }}
                    />
                  </div>
                  <span className="text-sm font-medium text-slate-300">{card.detalhe}</span>
                </div>
              )}
            </CardContent>
          </Card>
        ))
        }
      </div>


      {/* Gráficos de tempo médio + top operadores */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="glass glow-blue border-0 overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500/20 to-sky-500/20">
                <Timer className="h-5 w-5 text-blue-400 icon-glow" />
              </div>
              <span className="font-bold">Tempo Médio de Resposta</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4 p-3 rounded-xl bg-white/5">
              <div className="flex flex-col">
                <span className="text-[10px] uppercase text-slate-400 tracking-wider">Meta</span>
                <span className="text-lg font-mono font-bold text-blue-400">{formatMinutosCompleto(metasSla.respostaMinutos)}</span>
              </div>
              <div className="w-px h-10 bg-slate-600" />
              <div className="flex flex-col">
                <span className="text-[10px] uppercase text-slate-400 tracking-wider">Atual</span>
                <span className="text-lg font-mono font-bold text-white">{formatMinutosCompleto(temposExibicao.tempoMedioAbertura)}</span>
              </div>
            </div>
            <div className="space-y-3">
              {tempoRespostaExibicao.length === 0 && (
                <p className="text-sm text-muted-foreground">Sem dados para operadores.</p>
              )}
              {(() => {
                const listaResposta = tempoRespostaExibicao.slice(0, 8);
                const totalItens = listaResposta.length;
                return listaResposta.map((op, idx) => {
                  const maxValor = listaResposta[listaResposta.length - 1]?.tempoMedioMinutos || 1;
                  const value = maxValor ? (op.tempoMedioMinutos / maxValor) * 100 : 0;
                  const isLast2 = idx >= totalItens - 2;

                  const rankingData = rankingOperadores.find(r => r.nome === op.nome);
                  const totalTickets = rankingData?.total || 0;
                  const mediaDiariaOp = rankingData?.mediaDiaria?.toFixed(2) || '0.00';

                  return (
                    <div key={op.nome} className="space-y-1.5 group">
                      <div className="flex items-center justify-between text-sm">
                        <span className={cn("font-semibold flex items-center gap-2", isLast2 ? "text-red-400" : "text-slate-200")}>
                          <span className={cn("w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center", isLast2 ? "bg-red-500/20 text-red-400" : "bg-blue-500/20 text-blue-400")}>{idx + 1}</span>
                          {op.nome}
                        </span>
                        <span className={cn("font-mono text-sm font-semibold", isLast2 ? "text-red-400" : "text-blue-300")}>
                          {formatMinutosCompleto(op.tempoMedioMinutos)}
                        </span>
                      </div>
                      <TooltipProvider delayDuration={100}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className="group relative cursor-pointer"
                              onClick={() => {
                                updateFilters({ analista: op.nome });
                                setLocation('/operacional');
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  updateFilters({ analista: op.nome });
                                  setLocation('/operacional');
                                }
                              }}
                              role="link"
                              tabIndex={0}
                              aria-label={`Ver detalhes operacionais de ${op.nome}`}
                            >
                              <div className="h-2.5 bg-slate-700/50 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-blue-600 via-blue-500 to-sky-400 rounded-full transition-all duration-500 group-hover:shadow-lg group-hover:shadow-blue-500/40"
                                  style={{ width: `${value}%` }}
                                />
                              </div>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent
                            side="top"
                            className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-blue-500/30 shadow-xl shadow-blue-500/20 p-0 overflow-hidden"
                          >
                            <div className="p-3 min-w-[220px]">
                              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-blue-500/20">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white font-bold text-sm">
                                  {op.nome.slice(0, 2).toUpperCase()}
                                </div>
                                <div>
                                  <p className="font-bold text-white text-sm">{op.nome}</p>
                                  <p className="text-[10px] text-blue-300/70">Tempo de Resposta</p>
                                </div>
                              </div>
                              <div className="grid grid-cols-3 gap-2 text-xs">
                                <div className="bg-slate-800/50 rounded-lg p-2 text-center">
                                  <p className="text-blue-400 font-mono text-lg font-bold">{totalTickets}</p>
                                  <p className="text-slate-400 text-[10px]">Tickets</p>
                                </div>
                                <div className="bg-slate-800/50 rounded-lg p-2 text-center">
                                  <p className="text-amber-400 font-mono text-lg font-bold">{mediaDiariaOp}</p>
                                  <p className="text-slate-400 text-[10px]">Média/Dia</p>
                                </div>
                                <div className="bg-slate-800/50 rounded-lg p-2 text-center">
                                  <p className="text-emerald-400 font-mono text-sm font-bold">{formatMinutosCompleto(op.tempoMedioMinutos)}</p>
                                  <p className="text-slate-400 text-[10px]">Tempo</p>
                                </div>
                              </div>
                              <div className="mt-2 pt-2 border-t border-slate-700/50">
                                <div className="flex justify-between items-center">
                                  <span className="text-[10px] text-slate-400">Comparação</span>
                                  <span className="text-[10px] font-mono text-amber-400">{value.toFixed(0)}%</span>
                                </div>
                                <div className="w-full bg-slate-700/50 rounded-full h-1.5 mt-1 overflow-hidden">
                                  <div className="bg-gradient-to-r from-blue-500 to-cyan-400 h-full rounded-full transition-all" style={{ width: `${value}%` }} />
                                </div>
                              </div>
                              <div className="mt-2 pt-2 border-t border-blue-500/20 text-center">
                                <span className="text-[10px] text-blue-400">👆 Clique para ver detalhes</span>
                              </div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  );
                });
              })()}
            </div>
          </CardContent>
        </Card>

        <Card className="glass glow-emerald border-0 overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-500/20">
                <Clock4 className="h-5 w-5 text-emerald-400 icon-glow" />
              </div>
              <span className="font-bold">Tempo Médio de Atendimento</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4 p-3 rounded-xl bg-white/5">
              <div className="flex flex-col">
                <span className="text-[10px] uppercase text-slate-400 tracking-wider">Meta</span>
                <span className="text-lg font-mono font-bold text-emerald-400">{formatMinutosCompleto(metasSla.solucaoMinutos)}</span>
              </div>
              <div className="w-px h-10 bg-slate-600" />
              <div className="flex flex-col">
                <span className="text-[10px] uppercase text-slate-400 tracking-wider">Atual</span>
                <span className="text-lg font-mono font-bold text-white">{formatMinutosCompleto(temposExibicao.tempoMedioSolucao)}</span>
              </div>
            </div>
            <div className="space-y-3">
              {tempoAtendimentoExibicao.length === 0 && (
                <p className="text-sm text-muted-foreground">Sem dados para operadores.</p>
              )}
              {(() => {
                const listaAtendimento = tempoAtendimentoExibicao.slice(0, 8);
                const totalItens = listaAtendimento.length;
                return listaAtendimento.map((op, idx) => {
                  const maxValor = listaAtendimento[listaAtendimento.length - 1]?.tempoMedioAtendimentoMinutos || 1;
                  const value = maxValor ? (op.tempoMedioAtendimentoMinutos / maxValor) * 100 : 0;
                  const isLast2 = idx >= totalItens - 2;

                  const rankingData = rankingOperadores.find(r => r.nome === op.nome);
                  const totalTickets = rankingData?.total || 0;
                  const mediaDiariaOp = rankingData?.mediaDiaria?.toFixed(2) || '0.00';

                  return (
                    <div key={op.nome} className="space-y-1.5 group">
                      <div className="flex items-center justify-between text-sm">
                        <span className={cn("font-semibold flex items-center gap-2", isLast2 ? "text-red-400" : "text-slate-200")}>
                          <span className={cn("w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center", isLast2 ? "bg-red-500/20 text-red-400" : "bg-emerald-500/20 text-emerald-400")}>{idx + 1}</span>
                          {op.nome}
                        </span>
                        <span className={cn("font-mono text-sm font-semibold", isLast2 ? "text-red-400" : "text-emerald-300")}>
                          {formatMinutosCompleto(op.tempoMedioAtendimentoMinutos)}
                        </span>
                      </div>
                      <TooltipProvider delayDuration={100}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className="group relative cursor-pointer"
                              onClick={() => {
                                updateFilters({ analista: op.nome });
                                setLocation('/operacional');
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  updateFilters({ analista: op.nome });
                                  setLocation('/operacional');
                                }
                              }}
                              role="link"
                              tabIndex={0}
                              aria-label={`Ver detalhes operacionais de ${op.nome}`}
                            >
                              <div className="h-2.5 bg-slate-700/50 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-400 rounded-full transition-all duration-500 group-hover:shadow-lg group-hover:shadow-emerald-500/40"
                                  style={{ width: `${value}%` }}
                                />
                              </div>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent
                            side="top"
                            className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-emerald-500/30 shadow-xl shadow-emerald-500/20 p-0 overflow-hidden"
                          >
                            <div className="p-3 min-w-[220px]">
                              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-emerald-500/20">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white font-bold text-sm">
                                  {op.nome.slice(0, 2).toUpperCase()}
                                </div>
                                <div>
                                  <p className="font-bold text-white text-sm">{op.nome}</p>
                                  <p className="text-[10px] text-emerald-300/70">Tempo de Atendimento</p>
                                </div>
                              </div>
                              <div className="grid grid-cols-3 gap-2 text-xs">
                                <div className="bg-slate-800/50 rounded-lg p-2 text-center">
                                  <p className="text-emerald-400 font-mono text-lg font-bold">{totalTickets}</p>
                                  <p className="text-slate-400 text-[10px]">Tickets</p>
                                </div>
                                <div className="bg-slate-800/50 rounded-lg p-2 text-center">
                                  <p className="text-amber-400 font-mono text-lg font-bold">{mediaDiariaOp}</p>
                                  <p className="text-slate-400 text-[10px]">Média/Dia</p>
                                </div>
                                <div className="bg-slate-800/50 rounded-lg p-2 text-center">
                                  <p className="text-cyan-400 font-mono text-sm font-bold">{formatMinutosCompleto(op.tempoMedioAtendimentoMinutos)}</p>
                                  <p className="text-slate-400 text-[10px]">Tempo</p>
                                </div>
                              </div>
                              <div className="mt-2 pt-2 border-t border-slate-700/50">
                                <div className="flex justify-between items-center">
                                  <span className="text-[10px] text-slate-400">Comparação</span>
                                  <span className="text-[10px] font-mono text-amber-400">{value.toFixed(0)}%</span>
                                </div>
                                <div className="w-full bg-slate-700/50 rounded-full h-1.5 mt-1 overflow-hidden">
                                  <div className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full rounded-full transition-all" style={{ width: `${value}%` }} />
                                </div>
                              </div>
                              <div className="mt-2 pt-2 border-t border-emerald-500/20 text-center">
                                <span className="text-[10px] text-emerald-400">👆 Clique para ver detalhes</span>
                              </div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  );
                });
              })()}
            </div>
          </CardContent>
        </Card>

        <Card className="glass border-0 overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500/20 to-cyan-500/20">
                <Activity className="h-5 w-5 text-blue-400" />
              </div>
              <span className="gradient-text font-bold">Top 5 Operadores</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topOperadores.length === 0 && (
              <p className="text-sm text-muted-foreground">Sem dados no período.</p>
            )}
            {topOperadores.map((op, idx) => {
              const avatarSrc = getAvatarSrc(op.nome);
              const isFirst = idx === 0;
              const isSecond = idx === 1;
              const isThird = idx === 2;
              const positionChange = getPositionChange(op.nome, idx);

              return (
                <div
                  key={op.nome}
                  className={cn(
                    "flex items-center justify-between rounded-xl px-4 py-3 transition-all",
                    isFirst && "bg-gradient-to-r from-amber-500/20 via-yellow-500/10 to-transparent border border-amber-500/30 shimmer",
                    isSecond && "bg-slate-500/10 border border-slate-500/20",
                    isThird && "bg-amber-700/10 border border-amber-700/20",
                    idx === 3 && "bg-white/5 border border-white/10",
                    idx === 4 && "bg-white/5 border border-white/10"
                  )}
                >
                  <div className="flex items-center gap-4">
                    {/* Indicador de mudança de posição */}
                    <div className="w-4 flex items-center justify-center">
                      {positionChange === 'up' && (
                        <ArrowUp className="h-4 w-4 text-emerald-400" />
                      )}
                      {positionChange === 'down' && (
                        <ArrowDown className="h-4 w-4 text-red-400" />
                      )}
                      {positionChange === 'same' && (
                        <Minus className="h-3 w-3 text-slate-500" />
                      )}
                      {positionChange === 'new' && (
                        <span className="text-[10px] font-bold text-blue-400">N</span>
                      )}
                    </div>

                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold",
                      isFirst && "bg-gradient-to-br from-yellow-400 to-amber-500 text-yellow-950",
                      isSecond && "bg-gradient-to-br from-slate-300 to-slate-400 text-slate-900",
                      isThird && "bg-gradient-to-br from-amber-600 to-amber-700 text-amber-100",
                      idx >= 3 && "bg-slate-700 text-slate-300"
                    )}>
                      {idx + 1}
                    </div>
                    <Avatar className={cn(
                      "border-2 shadow-lg",
                      isFirst ? "h-14 w-14 ring-2 ring-yellow-500/50" : "h-12 w-12",
                      isSecond && "ring-1 ring-slate-400/30",
                      isThird && "ring-1 ring-amber-600/30"
                    )}>
                      {avatarSrc ? <AvatarImage src={avatarSrc} alt={op.nome} /> : null}
                      <AvatarFallback className={cn(
                        "font-bold",
                        isFirst && "bg-gradient-to-br from-yellow-600 to-amber-700 text-yellow-100"
                      )}>
                        {op.nome.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className={cn(
                        "font-bold flex items-center gap-2",
                        isFirst ? "text-lg text-yellow-300" : "text-base text-slate-200"
                      )}>
                        {isFirst && <Trophy className="h-5 w-5 text-yellow-400" />}
                        {isSecond && <Medal className="h-4 w-4 text-slate-400" />}
                        {isThird && <Medal className="h-4 w-4 text-amber-600" />}
                        {op.nome}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        <span className="font-semibold text-slate-300">{op.total}</span> chamados • <span className="font-semibold text-slate-300">{op.mediaDiaria.toFixed(2)}</span>/dia
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>


      </div>

      {/* Chamados Ativos (Atendendo + Pausado) */}
      <Card className="glass glow-emerald border-0 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-emerald-500/20 to-green-500/20 pulse-ring">
              <Activity className="h-5 w-5 text-emerald-400" />
            </div>
            <span className="font-bold text-lg">Chamados Ativos por Operador</span>
            <span className="ml-auto px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-sm font-medium">
              {chamadosAtivos.length} em andamento
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rankingChamadosAtivos.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              Nenhum chamado ativo no momento.
            </p>
          ) : (
            <div className="rounded-xl overflow-hidden border border-white/5">
              <Table>
                <TableHeader>
                  <TableRow className="bg-white/5 hover:bg-white/5 border-b border-white/10">
                    <TableHead className="text-slate-300 font-semibold">Operador</TableHead>
                    <TableHead className="text-slate-300 font-semibold">Avatar</TableHead>
                    <TableHead className="text-center text-slate-300 font-semibold">
                      <span className="inline-flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
                        Atendendo
                      </span>
                    </TableHead>
                    <TableHead className="text-center text-slate-300 font-semibold">
                      <span className="inline-flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-yellow-500" />
                        Pausado
                      </span>
                    </TableHead>
                    <TableHead className="text-center text-slate-300 font-semibold">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rankingChamadosAtivos.map((op, idx) => (
                    <TableRow
                      key={op.nome}
                      className={cn(
                        "cursor-pointer transition-all border-b border-white/5",
                        "hover:bg-gradient-to-r hover:from-emerald-500/10 hover:to-transparent",
                        idx % 2 === 0 && "bg-white/[0.02]"
                      )}
                      onClick={() => {
                        updateFilters({ analista: op.nome });
                        setLocation(`/operacional?status=Atendendo,Pausado`);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          updateFilters({ analista: op.nome });
                          setLocation(`/operacional?status=Atendendo,Pausado`);
                        }
                      }}
                      tabIndex={0}
                    >
                      <TableCell className="font-semibold text-slate-200">{op.nome}</TableCell>
                      <TableCell>
                        <Avatar className="h-11 w-11 border-2 border-emerald-500/30 shadow-lg">
                          <AvatarImage src={getAvatarSrc(op.nome)} alt={op.nome} />
                          <AvatarFallback className="bg-gradient-to-br from-emerald-600 to-green-700 text-white font-bold">
                            {op.nome.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </TableCell>
                      <TableCell className="text-center">
                        {op.atendendo > 0 ? (
                          <span className="inline-flex items-center justify-center min-w-[2.5rem] px-3 py-1.5 rounded-full bg-gradient-to-r from-emerald-500 to-green-500 text-white font-bold text-sm shadow-lg shadow-emerald-500/30">
                            {op.atendendo}
                          </span>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {op.pausado > 0 ? (
                          <span className="inline-flex items-center justify-center min-w-[2.5rem] px-3 py-1.5 rounded-full bg-gradient-to-r from-yellow-500 to-amber-500 text-yellow-950 font-bold text-sm shadow-lg shadow-yellow-500/30">
                            {op.pausado}
                          </span>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="font-mono text-lg font-bold text-white">
                          {op.total}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
