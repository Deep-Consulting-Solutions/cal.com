import { CalendarProvider, CalendarProviderService, CalendarProviderConfig } from "./types";

export abstract class BaseCalendarProvider implements CalendarProviderService {
  protected config: Partial<CalendarProviderConfig>;

  constructor(public provider: CalendarProvider) {
    this.config = this.loadConfiguration();
  }

  abstract isConfigured(): boolean;
  abstract getConfigurationError(): string | null;
  abstract fetchUsers(): Promise<any[]>;
  abstract createSetup(params: any): Promise<any>;
  abstract updateSetup(params: any): Promise<any>;
  abstract generateOAuthUrl(userId: string): Promise<string>;
  abstract getAppSlug(): string;
  abstract getDisplayName(): string;

  protected abstract loadConfiguration(): Partial<CalendarProviderConfig>;

  protected getRequiredEnvVar(name: string): string | undefined {
    return process.env[name];
  }

  protected validateConfiguration(requiredFields: string[]): string | null {
    const missing = requiredFields.filter((field) => !this.config[field as keyof CalendarProviderConfig]);

    if (missing.length > 0) {
      return `Missing configuration for ${this.getDisplayName()}: ${missing.join(", ")}`;
    }

    return null;
  }
}
