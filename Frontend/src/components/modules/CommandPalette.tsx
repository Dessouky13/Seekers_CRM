import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { OPEN_COMMAND_PALETTE } from "@/lib/command-palette";
import {
  Search, Users, Building2, CheckSquare, StickyNote, LayoutDashboard,
  DollarSign, Send, Target, Lock, Settings, Sparkles, Sun, Radar,
  UsersRound, FileText, UserPlus, ListPlus, Receipt,
} from "lucide-react";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { apiFetch } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useCurrentUser } from "@/hooks/useAuth";
import { openQuickAdd, type QuickAddKind } from "@/lib/quick-add";
import type { ApiLead, ApiClient, ApiTask } from "@/lib/types";

// Things you DO, as opposed to places you go.
//
// The palette could only navigate, and the one surface that could create
// anything (QuickAdd) is `md:hidden` — so on a desktop there was no quick-create
// at all and "add this lead before I forget" meant loading the CRM page and
// hunting for its header button.
//
// `shortcut` is the bare key pressed on its own. Deliberately single letters
// with no modifier: they are cheap to hit and the handler ignores them while a
// field has focus. Shown in this list so they are learned by using the palette
// rather than from documentation nobody opens.
const ACTIONS: {
  label: string; kind: QuickAddKind; icon: typeof Users;
  keywords: string; shortcut: string; adminOnly?: boolean;
}[] = [
  { label: "New lead",   kind: "lead",    icon: UserPlus,  keywords: "create add prospect contact", shortcut: "l" },
  { label: "New task",   kind: "task",    icon: ListPlus,  keywords: "create add todo",             shortcut: "t" },
  { label: "Log expense", kind: "expense", icon: Receipt,  keywords: "create add money out spend cost", shortcut: "e", adminOnly: true },
];

// Fires an action key only when it is a real keystroke and not typing. Exported
// shape kept private — the palette owns the shortcut table so the list and the
// keys can never disagree about which letter does what.
function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || node.isContentEditable;
}

// Keep in step with the routes in App.tsx. This list had gone stale — Today,
// Outbound, Team and Knowledge shipped without being added, so the palette
// couldn't reach them.
const PAGES: { label: string; path: string; icon: typeof LayoutDashboard; keywords?: string }[] = [
  { label: "Today",      path: "/",          icon: Sun,             keywords: "home queue focus now worklist" },
  { label: "Dashboard",  path: "/dashboard", icon: LayoutDashboard, keywords: "overview kpis" },
  { label: "Finance",    path: "/finance",   icon: DollarSign,      keywords: "money income expense transactions p&l" },
  { label: "Tasks",      path: "/tasks",     icon: CheckSquare,     keywords: "todo kanban projects" },
  { label: "Clients",    path: "/clients",   icon: Building2,       keywords: "customers accounts" },
  { label: "CRM Leads",  path: "/crm",       icon: Users,           keywords: "pipeline prospects deals" },
  { label: "Quotations", path: "/quotations", icon: FileText,       keywords: "quote proposal invoice billing pdf retainer setup fee estimate" },
  { label: "Outreach",   path: "/outreach",  icon: Send,            keywords: "sequences email enrollments campaigns" },
  { label: "Outbound",   path: "/outbound",  icon: Radar,           keywords: "intel enrichment deliverability mailbox audits" },
  { label: "Goals",      path: "/goals",     icon: Target,          keywords: "okr targets" },
  { label: "Notes",      path: "/notes",     icon: StickyNote,      keywords: "scratchpad board ideas" },
  // NOTE: Knowledge.tsx exists (228 lines) but has no route in App.tsx and no
  // sidebar entry, so it is currently unreachable. Deliberately not listed here
  // — the palette must not offer a dead link. Either route it or delete it.
  { label: "Team",       path: "/team",      icon: UsersRound,      keywords: "members access roles staff tracking" },
  { label: "Vault",      path: "/vault",     icon: Lock,            keywords: "passwords secrets credentials" },
  { label: "Settings",   path: "/settings",  icon: Settings,        keywords: "profile account signature webhooks" },
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
  const user              = useCurrentUser();
  const isAdmin           = user?.role === "admin";

  // The key handler is registered once, so it would otherwise close over the
  // first render's `open` and `role` forever. Refs keep it reading the current
  // values without re-binding the listener on every keystroke.
  const openRef = useRef(open);
  const roleRef = useRef(user?.role);
  openRef.current = open;
  roleRef.current = user?.role;

  const actions = ACTIONS.filter((a) => !a.adminOnly || isAdmin);

  // Cmd+K / Ctrl+K toggle, plus an event any component can fire.
  //
  // The keyboard shortcut was the ONLY way in, which meant the one search that
  // actually queries leads, clients and tasks was unreachable on a phone. An
  // event keeps this component the owner of its own state — no context, no
  // prop-drilling through AppLayout — so a button anywhere can open it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }

      // Bare-letter shortcuts for the three things done dozens of times a day.
      //
      // Guarded three ways, because an unmodified letter is the most
      // hijackable kind of shortcut there is: not while any modifier is held
      // (so Ctrl+L still reaches the browser), not while the palette itself is
      // open (its own input would swallow it anyway), and not while the caret
      // is in a field — otherwise typing "lead" into a search box would fire
      // three of these.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (openRef.current) return;
      if (isTypingTarget(e.target)) return;

      const action = ACTIONS.find((a) => a.shortcut === e.key.toLowerCase());
      if (!action) return;
      if (action.adminOnly && roleRef.current !== "admin") return;
      e.preventDefault();
      openQuickAdd(action.kind);
    };
    const onOpenRequest = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COMMAND_PALETTE, onOpenRequest);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COMMAND_PALETTE, onOpenRequest);
    };
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

        {/* Actions — first, because doing beats going. Filtered by the same
            free-text match the pages use, so "money" surfaces Log expense. */}
        {(() => {
          const q = debounced.trim().toLowerCase();
          const shown = actions.filter((a) => !q || `${a.label} ${a.keywords}`.toLowerCase().includes(q));
          if (shown.length === 0) return null;
          return (
            <CommandGroup heading="Actions">
              {shown.map(({ label, kind, icon: Icon, shortcut }) => (
                <CommandItem
                  key={kind}
                  value={`action-${kind}-${label}`}
                  onSelect={() => { setOpen(false); setQuery(""); openQuickAdd(kind); }}
                >
                  <Icon className="mr-2 h-3.5 w-3.5 text-primary" />
                  <span>{label}</span>
                  {/* The shortcut is taught here rather than in a help page. */}
                  <kbd className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {shortcut.toUpperCase()}
                  </kbd>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })()}

        {/* Pages — always shown */}
        <CommandGroup heading="Pages">
          {PAGES
            // Match the synonyms too, so "money" finds Finance and "queue"
            // finds Today — matching the label alone made the palette feel
            // broken whenever you didn't guess our exact wording.
            .filter((p) => {
              const q = debounced.trim().toLowerCase();
              if (!q) return true;
              return `${p.label} ${p.keywords ?? ""}`.toLowerCase().includes(q);
            })
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
                onSelect={() => go(`/crm?lead=${l.id}`)}
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
                onSelect={() => go(`/tasks?task=${t.id}`)}
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
              <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Cmd</kbd>+<kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">K</kbd> anytime
              {actions.length > 0 && <> · then {actions.map((a) => a.shortcut.toUpperCase()).join(" / ")} on their own to create</>}
            </span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
