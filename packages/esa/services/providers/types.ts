export type CalendarProvider = "zoho" | "office365";

export interface CalendarProviderConfig {
  provider: CalendarProvider;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

export interface CalendarProviderUser {
  id: string;
  email: string;
  name: string;
  timeZone: string;
  hasCalendar: boolean;
  status: "Not Started" | "In Progress" | "Completed" | "Pending Completion";
  userId?: string;
  scheduleId?: string;
  zoomUserId?: string;
}

export interface CalendarProviderSchedule {
  availability: Array<Array<{ start: string; end: string }>>;
  timeZone: string;
  name: string;
}

export interface ProviderSetupResult {
  success: boolean;
  oauthUrl?: string;
  error?: string;
}

export interface CalendarProviderService {
  provider: CalendarProvider;

  /**
   * Check if the provider is properly configured
   */
  isConfigured(): boolean;

  /**
   * Get configuration error if any
   */
  getConfigurationError(): string | null;

  /**
   * Fetch users from the provider's system
   */
  fetchUsers(): Promise<CalendarProviderUser[]>;

  /**
   * Create initial setup for a user
   */
  createSetup(params: {
    userId: string;
    email: string;
    name: string;
    timeZone: string;
    schedule: CalendarProviderSchedule;
    zoomUserId?: string;
  }): Promise<ProviderSetupResult>;

  /**
   * Update existing setup
   */
  updateSetup(params: {
    userId: string;
    schedule?: CalendarProviderSchedule;
    zoomUserId?: string;
    calendars?: Array<{
      externalId: string;
      credentialId: number;
      selected: boolean;
    }>;
  }): Promise<ProviderSetupResult>;

  /**
   * Generate OAuth URL for calendar connection
   * @param userId - User ID for the OAuth flow
   * @param managedSetupId - Optional managed setup ID to include in state
   */
  generateOAuthUrl(userId: string, managedSetupId?: number): Promise<string>;

  /**
   * Get provider-specific app slug
   */
  getAppSlug(): string;

  /**
   * Get provider display name
   */
  getDisplayName(): string;
}
