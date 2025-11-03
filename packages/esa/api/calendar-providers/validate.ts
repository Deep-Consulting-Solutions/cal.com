import type { NextApiRequest } from "next";

import { defaultResponder } from "@calcom/lib/server";

import { ProviderFactory, CalendarProvider } from "../../services/providers";

export async function getHandler(req: NextApiRequest) {
  const providerParam = req.query.provider as string;

  if (!providerParam) {
    // Return all available providers with their status
    const providers = ["zoho", "office365"] as CalendarProvider[];
    const results = providers.map((provider) => {
      const service = ProviderFactory.getProvider(provider);
      return {
        provider,
        displayName: service.getDisplayName(),
        configured: service.isConfigured(),
        error: service.getConfigurationError(),
      };
    });

    return {
      providers: results,
      availableProviders: ProviderFactory.getAvailableProviders(),
    };
  }

  // Validate specific provider
  const provider = providerParam as CalendarProvider;
  const validation = ProviderFactory.validateProvider(provider);
  const service = ProviderFactory.getProvider(provider);

  return {
    provider,
    displayName: service.getDisplayName(),
    valid: validation.valid,
    configured: service.isConfigured(),
    error: validation.error,
  };
}

export default defaultResponder(getHandler);
