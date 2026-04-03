import type {
  profiles,
  clients,
  projects,
  tasks,
  subtasks,
  transactions,
  leads,
  leadActivities,
  goals,
  kbDocuments,
  kbChunks,
  notifications,
  notificationEvents,
  refreshTokens,
  teamInvites,
  vaultCategories,
} from "../db/schema";

// ── Drizzle inferred types ────────────────────────────────

export type Profile         = typeof profiles.$inferSelect;
export type NewProfile      = typeof profiles.$inferInsert;

export type Client          = typeof clients.$inferSelect;
export type NewClient       = typeof clients.$inferInsert;

export type Project         = typeof projects.$inferSelect;
export type NewProject      = typeof projects.$inferInsert;

export type Task            = typeof tasks.$inferSelect;
export type NewTask         = typeof tasks.$inferInsert;

export type Subtask         = typeof subtasks.$inferSelect;
export type NewSubtask      = typeof subtasks.$inferInsert;

export type Transaction     = typeof transactions.$inferSelect;
export type NewTransaction  = typeof transactions.$inferInsert;

export type Lead            = typeof leads.$inferSelect;
export type NewLead         = typeof leads.$inferInsert;

export type LeadActivity    = typeof leadActivities.$inferSelect;
export type NewLeadActivity = typeof leadActivities.$inferInsert;

export type Goal            = typeof goals.$inferSelect;
export type NewGoal         = typeof goals.$inferInsert;

export type KbDocument      = typeof kbDocuments.$inferSelect;
export type NewKbDocument   = typeof kbDocuments.$inferInsert;

export type KbChunk         = typeof kbChunks.$inferSelect;
export type NewKbChunk      = typeof kbChunks.$inferInsert;

export type Notification    = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export type NotificationEvent    = typeof notificationEvents.$inferSelect;
export type NewNotificationEvent = typeof notificationEvents.$inferInsert;

export type VaultCategory    = typeof vaultCategories.$inferSelect;
export type NewVaultCategory = typeof vaultCategories.$inferInsert;

export type RefreshToken    = typeof refreshTokens.$inferSelect;
export type TeamInvite      = typeof teamInvites.$inferSelect;

// ── Hono context variable types ───────────────────────────

/** Profile without the password hash — safe to return to clients */
export type SafeProfile = Omit<Profile, "password">;

export type AppVariables = {
  user: Profile;
};

export type AppEnv = {
  Variables: AppVariables;
};

// ── Auth response shapes ──────────────────────────────────

export type AuthResponse = {
  access_token:  string;
  refresh_token: string;
  user:          SafeProfile;
};

// ── API pagination wrapper ────────────────────────────────

export type PaginatedResponse<T> = {
  data:  T[];
  total: number;
  page:  number;
  limit: number;
};
