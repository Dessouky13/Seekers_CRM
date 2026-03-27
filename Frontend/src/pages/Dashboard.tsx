import { DollarSign, TrendingUp, Users, CheckCircle, AlertTriangle, Target, Clock } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { StatCard } from "@/components/modules/StatCard";
import { Progress } from "@/components/ui/progress";
import { useDashboardSummary } from "@/hooks/useDashboard";
import { useStaleLeads } from "@/hooks/useCRM";
import { useCurrentUser } from "@/hooks/useAuth";

const COLORS = ["hsl(246,90%,60%)", "hsl(255,40%,72%)", "hsl(152,60%,45%)", "hsl(38,92%,55%)", "hsl(0,72%,55%)"];
const fmt = (n: number) => `EGP ${n.toLocaleString()}`;

const priorityColors: Record<string, string> = {
  low:      "bg-muted text-muted-foreground",
  medium:   "bg-info/15 text-info",
  high:     "bg-warning/20 text-warning",
  critical: "bg-destructive/20 text-destructive",
};

export default function Dashboard() {
  const user    = useCurrentUser();
  const { data, isLoading } = useDashboardSummary();
  const { data: staleLeads = [] } = useStaleLeads();

  const income      = data?.finance.total_income   ?? 0;
  const expenses    = data?.finance.total_expenses ?? 0;
  const profit      = data?.finance.net_profit     ?? 0;
  const margin      = data?.finance.profit_margin  ?? 0;
  const revenueData = data?.finance.revenue_by_month    ?? [];
  const expenseData = data?.finance.expense_by_category ?? [];

  const taskTotal      = data?.tasks.total           ?? 0;
  const taskCompleted  = data?.tasks.completed        ?? 0;
  const taskCompletion = data?.tasks.completion_rate  ?? 0;
  const overdueItems   = data?.tasks.overdue_items    ?? [];

  const activeLeads    = data?.leads.active          ?? 0;
  const totalLeads     = data?.leads.total            ?? 0;
  const goals          = data?.goals                  ?? [];

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Loading dashboard…</div>;
  }

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {(() => {
            const h = new Date().getHours();
            const greeting = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
            return `${greeting}, ${user?.name ?? "…"}. Here's your overview.`;
          })()}
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Revenue" value={fmt(income)} change={`${margin}% margin`} changeType="positive" icon={DollarSign} />
        <StatCard title="Net Profit" value={fmt(profit)} change={`${fmt(expenses)} expenses`} changeType="positive" icon={TrendingUp} />
        <StatCard title="Active Leads" value={String(activeLeads)} change={`${totalLeads} total`} changeType="neutral" icon={Users} />
        <StatCard title="Task Completion" value={`${taskCompletion}%`} change={`${taskCompleted}/${taskTotal} done`} changeType="neutral" icon={CheckCircle} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border border-border bg-card p-5 animate-fade-in" style={{ animationDelay: "100ms" }}>
          <h2 className="text-sm font-semibold text-foreground mb-4">Revenue Trend</h2>
          {revenueData.length === 0 ? (
            <div className="flex items-center justify-center h-60 text-muted-foreground text-sm">No revenue data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={revenueData} barSize={28}>
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "hsl(226,12%,55%)", fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "hsl(226,12%,55%)", fontSize: 12 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: "hsl(230,22%,12%)", border: "1px solid hsl(230,16%,18%)", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "hsl(226,20%,88%)" }}
                  formatter={(v: number) => [fmt(v), "Revenue"]}
                />
                <Bar dataKey="revenue" fill="hsl(246,90%,60%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-5 animate-fade-in" style={{ animationDelay: "200ms" }}>
          <h2 className="text-sm font-semibold text-foreground mb-4">Expense Breakdown</h2>
          {expenseData.length === 0 ? (
            <div className="flex items-center justify-center h-60 text-muted-foreground text-sm">No expense data yet</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={expenseData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                    {expenseData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "hsl(230,22%,12%)", border: "1px solid hsl(230,16%,18%)", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number, name: string) => [fmt(v), name]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                {expenseData.map((item, i) => (
                  <div key={item.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <div className="h-2 w-2 rounded-full" style={{ background: COLORS[i] }} />
                    {item.name}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Stale leads alert */}
        <div className="rounded-xl border border-border bg-card p-5 animate-fade-in" style={{ animationDelay: "250ms" }}>
          <div className="flex items-center gap-2 mb-4">
            <Clock className="h-4 w-4 text-destructive" />
            <h2 className="text-sm font-semibold text-foreground">Stale Leads</h2>
            {staleLeads.length > 0 && (
              <span className="ml-auto text-xs font-semibold text-destructive bg-destructive/10 px-2 py-0.5 rounded-full">
                {staleLeads.length}
              </span>
            )}
          </div>
          {staleLeads.length === 0 ? (
            <p className="text-sm text-muted-foreground">All leads are up to date</p>
          ) : (
            <div className="space-y-3">
              {staleLeads.slice(0, 5).map((lead) => (
                <div key={lead.id} className="flex items-center justify-between rounded-lg bg-destructive/5 border border-destructive/10 p-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{lead.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {lead.company}{lead.lastActivity ? ` · Last: ${lead.lastActivity}` : " · No activity"}
                    </p>
                  </div>
                  <span className="capitalize text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    {lead.stage.replace(/_/g, " ")}
                  </span>
                </div>
              ))}
              {staleLeads.length > 5 && (
                <p className="text-xs text-muted-foreground text-center">+{staleLeads.length - 5} more stale leads</p>
              )}
            </div>
          )}
        </div>

        {/* Overdue tasks */}
        <div className="rounded-xl border border-border bg-card p-5 animate-fade-in" style={{ animationDelay: "300ms" }}>
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <h2 className="text-sm font-semibold text-foreground">Overdue Tasks</h2>
          </div>
          {overdueItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">No overdue tasks</p>
          ) : (
            <div className="space-y-3">
              {overdueItems.map((task) => (
                <div key={task.id} className="flex items-center justify-between rounded-lg bg-muted/40 p-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{task.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Due {task.due_date ?? "—"}{task.assignee_name ? ` · ${task.assignee_name}` : ""}
                    </p>
                  </div>
                  <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${priorityColors[task.priority] ?? ""}`}>
                    {task.priority}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Goals */}
        <div className="rounded-xl border border-border bg-card p-5 animate-fade-in" style={{ animationDelay: "400ms" }}>
          <div className="flex items-center gap-2 mb-4">
            <Target className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Goals Progress</h2>
          </div>
          {goals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No goals set yet. Add goals in the Goals page.</p>
          ) : (
            <div className="space-y-4">
              {goals.map((goal) => (
                <div key={goal.title}>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-sm text-foreground">{goal.title}</p>
                    <span className="text-xs text-muted-foreground tabular-nums">{goal.progress_pct}%</span>
                  </div>
                  <Progress value={goal.progress_pct} className="h-2" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
