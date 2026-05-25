import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search, Users, Building2, CheckSquare, StickyNote, LayoutDashboard,
  DollarSign, Send, Target, Lock, Settings, Sparkles,
} from "lucide-react";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { apiFetch } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { ApiLead, ApiClient, ApiTask } from "@/lib/types";

const PAGES: { label: string; path: string; icon: typeof LayoutDashboard }[] = [
  { label: "Dashboard",  path: "/",          icon: LayoutDashboard },
  { label: "Finance",    path: "/finance",   icon: DollarSign },
  { label: "Tasks",      path: "/tasks",     icon: CheckSquare },
  { label: "Clients",    path: "/clients",   icon: Building2 },
  { label: "CRM Leads",  path: "/crm",       icon: Users },
  { label: "Outreach",   path: "/outreach",  icon: Send },
  { label: "Goals",      path: "/goals",     icon: Target },
  { label: "Notes",      path: "/notes",     icon: StickyNote },
  { label: "Vault",      path: "/vault",     icon: Lock },
  { label: "Settings",   path: "/settings",  icon: Settings },
];

interface SearchResults {
  leads:   ApiLead[];
  clients: ApiClient[];
  tasks:   ApiTask[];
}

export function CommandPalette() {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState("");
  const debounced         = useDebouncedValue(query, 200);
  const navigate          = useNavigate();

  // Cmd+K / Ctrl+K toggle
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Search leads (server-side, supports the existing ?search= param)
  const { data: leads = [] } = useQuery<ApiLead[]>({
    queryKey: ["palette-leads", debounced],
    queryFn:  () => apiFetch(`/crm/leads?search=${encodeURIComponent(debounced)}&limit=8`),
    enabled:  open && debounced.length >= 2,
  });

  // Search clients (server-side, supports the existing ?search= param)
  const { data: clients = [] } = useQuery<ApiClient[]>({
    queryKey: ["palette-clients", debounced],
    queryFn:  () => apiFetch(`/clients?search=${encodeURIComponent(debounced)}`),
    enabled:  open && debounced.length >= 2,
  });

  // Tasks — fetch once, filter client-side (no search param on backend)
  const { data: tasksRes } = useQuery<{ data: ApiTask[] }>({
    queryKey: ["palette-tasks"],
    queryFn:  () => apiFetch("/tasks"),
    enabled:  open,
    staleTime: 30_000,
  });
  const tasks = (tasksRes?.data ?? []).filter((t) =>
    !debounced || t.title.toLowerCase().includes(debounced.toLowerCase()),
  ).slice(0, 8);

  const go = (path: string) => { setOpen(false); setQuery(""); navigate(path); };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search leads, clients, tasks, or jump to a page…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="max-h-[440px]">
        <CommandEmpty>
          {debounced.length < 2
            ? <span className="text-xs text-muted-foreground">Type at least 2 characters to search</span>
            : "No results found."}
        </CommandEmpty>

        {/* Pages — always shown */}
        <CommandGroup heading="Pages">
          {PAGES
            .filter((p) => !debounced || p.label.toLowerCase().includes(debounced.toLowerCase()))
            .map(({ label, path, icon: Icon }) => (
              <CommandItem key={path} onSelect={() => go(path)}>
                <Icon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                <span>{label}</span>
              </CommandItem>
            ))}
        </CommandGroup>

        {/* Leads */}
        {leads.length > 0 && (
          <CommandGroup heading="Leads">
            {leads.map((l) => (
              <CommandItem
                key={l.id}
                value={`lead-${l.id}-${l.name}-${l.company}`}
                onSelect={() => go(`/crm`)}
              >
                <Users className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="text-sm">{l.name}</span>
                  <span className="text-[10px] text-muted-foreground">{l.company} · {l.stage.replace(/_/g, " ")}</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Clients */}
        {clients.length > 0 && (
          <CommandGroup heading="Clients">
            {clients.map((c) => (
              <CommandItem
                key={c.id}
                value={`client-${c.id}-${c.name}-${c.company}`}
                onSelect={() => go(`/clients`)}
              >
                <Building2 className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="text-sm">{c.name}</span>
                  <span className="text-[10px] text-muted-foreground">{c.company} · {c.status}</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Tasks */}
        {tasks.length > 0 && (
          <CommandGroup heading="Tasks">
            {tasks.map((t) => (
              <CommandItem
                key={t.id}
                value={`task-${t.id}-${t.title}`}
                onSelect={() => go(`/tasks`)}
              >
                <CheckSquare className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="text-sm">{t.title}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {t.status.replace(/_/g, " ")}
                    {t.priority !== "medium" && ` · ${t.priority}`}
                    {t.client_name && ` · ${t.client_name}`}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading="Tip">
          <CommandItem disabled>
            <Sparkles className="mr-2 h-3 w-3 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">
              Press <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Cmd</kbd>+<kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">K</kbd> anytime
            </span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
