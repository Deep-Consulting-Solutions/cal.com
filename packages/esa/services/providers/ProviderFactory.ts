import { Office365CalendarProvider } from "./Office365CalendarProvider";
import { ZohoCalendarProvider } from "./ZohoCalendarProvider";
import { CalendarProvider, CalendarProviderService } from "./types";

export class ProviderFactory {
  private static providers: Map<CalendarProvider, CalendarProviderService> = new Map();

  static getProvider(provider: CalendarProvider): CalendarProviderService {
    // Check cache first
    if (this.providers.has(provider)) {
      return this.providers.get(provider)!;
    }

    // Create new provider instance
    let instance: CalendarProviderService;

    switch (provider) {
      case "zoho":
        instance = new ZohoCalendarProvider();
        break;
      case "office365":
        instance = new Office365CalendarProvider();
        break;
      default:
        throw new Error(`Unsupported calendar provider: ${provider}`);
    }

    // Cache the instance
    this.providers.set(provider, instance);
    return instance;
  }

  static getAvailableProviders(): CalendarProvider[] {
    const providers: CalendarProvider[] = [];

    // Check Zoho configuration
    const zohoProvider = this.getProvider("zoho");
    if (zohoProvider.isConfigured()) {
      providers.push("zoho");
    }

    // Check Office365 configuration
    const office365Provider = this.getProvider("office365");
    if (office365Provider.isConfigured()) {
      providers.push("office365");
    }

    return providers;
  }

  static validateProvider(provider: CalendarProvider): { valid: boolean; error?: string } {
    const providerService = this.getProvider(provider);

    if (!providerService.isConfigured()) {
      return {
        valid: false,
        error:
          providerService.getConfigurationError() ||
          `${providerService.getDisplayName()} is not properly configured`,
      };
    }

    return { valid: true };
  }
}
