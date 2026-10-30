import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart3,
  Database,
  Code,
  Layers,
  Users,
  RefreshCw,
  Shield,
  Zap,
  Globe,
  Server,
  Bell,
  Clock,
  Filter,
  Lock,
  Volume2,
  Activity,
  TrendingUp,
  CheckCircle,
} from "lucide-react";

export default function Sobre() {
  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Sobre o BI de Help Desk"
        subtitulo="Informações sobre o portal de Business Intelligence, funcionalidades e tecnologias utilizadas"
      />

      {/* Visão Geral */}
      <Card className="rounded-md bg-primary/5 border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            O que é o Portal de BI de Help Desk?
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Este portal centraliza todos os indicadores de desempenho do Help Desk em dashboards
            interativos e acionáveis. Desenvolvido para a Polo Telecom, o sistema integra-se
            diretamente com a API do Milvus para fornecer dados em tempo real sobre:
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="secondary" className="h-6 w-6 p-0 flex items-center justify-center">1</Badge>
              <span>Volume e status de chamados</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="secondary" className="h-6 w-6 p-0 flex items-center justify-center">2</Badge>
              <span>Tempos de resposta e atendimento</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="secondary" className="h-6 w-6 p-0 flex items-center justify-center">3</Badge>
              <span>Cumprimento de SLA</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="secondary" className="h-6 w-6 p-0 flex items-center justify-center">4</Badge>
              <span>Performance dos operadores</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Funcionalidades Implementadas */}
      <Card className="rounded-md border-green-500/30 bg-green-500/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            Funcionalidades Implementadas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="flex items-start gap-3">
              <Lock className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-medium">Autenticação Segura</h4>
                <p className="text-xs text-muted-foreground">
                  Login protegido com credenciais armazenadas no servidor via variáveis de ambiente.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <RefreshCw className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-medium">Atualização Automática</h4>
                <p className="text-xs text-muted-foreground">
                  Dados atualizados automaticamente em intervalos configuráveis (30s a 5min).
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Bell className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-medium">Alertas Sonoros</h4>
                <p className="text-xs text-muted-foreground">
                  Notificação com som e voz sintetizada quando novos chamados são detectados.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Activity className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-medium">Chamados Ativos</h4>
                <p className="text-xs text-muted-foreground">
                  Monitoramento em tempo real de chamados em atendimento e pausados por operador.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Filter className="h-5 w-5 text-purple-500 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-medium">Filtros Multi-Select</h4>
                <p className="text-xs text-muted-foreground">
                  Seleção múltipla de status (Atendendo, Finalizado, Pausado) para análise flexível.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Clock className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-medium">Métricas de Tempo</h4>
                <p className="text-xs text-muted-foreground">
                  Tempo médio de abertura, resposta e atendimento com metas visuais.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <TrendingUp className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-medium">Rankings de Operadores</h4>
                <p className="text-xs text-muted-foreground">
                  Top performers por tickets resolvidos, tempo de resposta e atendimento.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Volume2 className="h-5 w-5 text-cyan-500 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-medium">Teste de Voz</h4>
                <p className="text-xs text-muted-foreground">
                  Botão para testar a síntese de voz e verificar se alertas estão funcionando.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Globe className="h-5 w-5 text-indigo-500 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-medium">Acesso via Rede Local</h4>
                <p className="text-xs text-muted-foreground">
                  Dashboard acessível por IP local para visualização em múltiplos dispositivos.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Status por Cor */}
      <Card className="rounded-md">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Código de Cores dos Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded bg-green-500" />
              <span className="text-sm">Atendendo</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded bg-yellow-500" />
              <span className="text-sm">Pausado</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded bg-blue-500" />
              <span className="text-sm">Finalizado</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stack Tecnológica */}
      <Card className="rounded-md">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Code className="h-5 w-5" />
            Stack Tecnológica
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <Database className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-medium">Frontend</h4>
                  <p className="text-xs text-muted-foreground">
                    React + TypeScript, Vite, TailwindCSS, Shadcn UI, Recharts, TanStack Query.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Server className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-medium">Backend</h4>
                  <p className="text-xs text-muted-foreground">
                    Node.js, Express, TSX, integração com API Milvus via proxy.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <Zap className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-medium">APIs Integradas</h4>
                  <p className="text-xs text-muted-foreground">
                    Milvus (relatórios, chamados ativos), ElevenLabs e Web Speech API (síntese de voz).
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Shield className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-medium">Segurança</h4>
                  <p className="text-xs text-muted-foreground">
                    Variáveis de ambiente (.env), autenticação por sessão, gitignore configurado.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Equipe */}
      <Card className="rounded-md">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Users className="h-5 w-5" />
            Desenvolvimento
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="p-4 rounded-md bg-muted/50 space-y-2">
              <h4 className="text-sm font-medium">Polo Telecom</h4>
              <p className="text-xs text-muted-foreground">
                Empresa responsável pelo projeto e requisitos de negócio.
              </p>
            </div>
            <div className="p-4 rounded-md bg-muted/50 space-y-2">
              <h4 className="text-sm font-medium">Integração Milvus</h4>
              <p className="text-xs text-muted-foreground">
                Sistema de Help Desk que fornece os dados via API REST.
              </p>
            </div>
            <div className="p-4 rounded-md bg-muted/50 space-y-2">
              <h4 className="text-sm font-medium">BI & Analytics</h4>
              <p className="text-xs text-muted-foreground">
                Dashboard desenvolvido para análise de dados e tomada de decisão.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Contato */}
      <Card className="rounded-md">
        <CardContent className="p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Dúvidas, sugestões ou problemas? Entre em contato com a equipe de TI através do canal interno ou abra um ticket de suporte.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

