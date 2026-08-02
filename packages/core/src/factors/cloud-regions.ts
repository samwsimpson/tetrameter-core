/**
 * Cloud region codes → grid zones.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The grid table is keyed on ISO country codes, and nobody instruments their
 * application with an ISO country code. They pass whatever their platform calls
 * the region their workload runs in — `us-central1`, `eu-west-1`, `westeurope` —
 * because that is the string already sitting in their configuration.
 *
 * Without this map every one of those falls through to the global average. That
 * is not a rounding error: `us-central1` reads 475 gCO₂e/kWh instead of the US
 * average 384, and `europe-west1` reads 475 against a Belgian grid closer to
 * 150. A number that is wrong by a factor of three, carries no warning, and
 * looks exactly like a number that is right, is the worst thing this library can
 * produce — and it was producing it for every cloud-hosted caller.
 *
 * ── What it deliberately does not do ────────────────────────────────────────
 *
 * It resolves to the **country**, never to a sub-national grid, because country
 * annual averages are all the static table holds. `us-central1` is Iowa, whose
 * grid differs substantially from the US average, and this map does not pretend
 * otherwise — it hands back `US` and the caller receives the same sub-national
 * caveat any other US resolution gets. Sub-national accuracy needs the live
 * Electricity Maps adapter, and a lookup table that implied otherwise would be
 * claiming precision the underlying data cannot support.
 *
 * Regions are mapped from each provider's published location list. Where a
 * provider names a region for a city, the country is the country that city is
 * in — this is geography, not estimation, and it is the one part of the carbon
 * chain with no uncertainty band.
 */

/**
 * Lower-cased region code → grid zone key.
 *
 * Lower-cased because provider codes are conventionally lower-case and callers
 * paste them verbatim; the lookup normalises before consulting this map.
 */
export const CLOUD_REGIONS: ReadonlyMap<string, string> = new Map([
  // ── Google Cloud ──────────────────────────────────────────────────────────
  ["us-central1", "US"],
  ["us-east1", "US"],
  ["us-east4", "US"],
  ["us-east5", "US"],
  ["us-east7", "US"],
  ["us-south1", "US"],
  ["us-west1", "US"],
  ["us-west2", "US"],
  ["us-west3", "US"],
  ["us-west4", "US"],
  ["northamerica-northeast1", "CA"],
  ["northamerica-northeast2", "CA"],
  ["northamerica-south1", "MX"],
  ["southamerica-east1", "BR"],
  ["southamerica-west1", "CL"],
  ["europe-central2", "PL"],
  ["europe-north1", "FI"],
  ["europe-north2", "SE"],
  ["europe-southwest1", "ES"],
  ["europe-west1", "BE"],
  ["europe-west2", "GB"],
  ["europe-west3", "DE"],
  ["europe-west4", "NL"],
  ["europe-west6", "CH"],
  ["europe-west8", "IT"],
  ["europe-west9", "FR"],
  ["europe-west10", "DE"],
  ["europe-west12", "IT"],
  ["asia-east1", "TW"],
  ["asia-east2", "HK"],
  ["asia-northeast1", "JP"],
  ["asia-northeast2", "JP"],
  ["asia-northeast3", "KR"],
  ["asia-south1", "IN"],
  ["asia-south2", "IN"],
  ["asia-southeast1", "SG"],
  ["asia-southeast2", "ID"],
  ["australia-southeast1", "AU"],
  ["australia-southeast2", "AU"],
  ["me-central1", "QAT"],
  ["me-central2", "SA"],
  ["me-west1", "IL"],
  ["africa-south1", "ZA"],

  // ── AWS ───────────────────────────────────────────────────────────────────
  ["us-east-1", "US"],
  ["us-east-2", "US"],
  ["us-west-1", "US"],
  ["us-west-2", "US"],
  ["af-south-1", "ZA"],
  ["ap-east-1", "HK"],
  ["ap-south-1", "IN"],
  ["ap-south-2", "IN"],
  ["ap-northeast-1", "JP"],
  ["ap-northeast-2", "KR"],
  ["ap-northeast-3", "JP"],
  ["ap-southeast-1", "SG"],
  ["ap-southeast-2", "AU"],
  ["ap-southeast-3", "ID"],
  ["ap-southeast-4", "AU"],
  ["ap-southeast-5", "MY"],
  ["ap-southeast-7", "TH"],
  ["ca-central-1", "CA"],
  ["ca-west-1", "CA"],
  ["eu-central-1", "DE"],
  ["eu-central-2", "CH"],
  ["eu-north-1", "SE"],
  ["eu-south-1", "IT"],
  ["eu-south-2", "ES"],
  ["eu-west-1", "IE"],
  ["eu-west-2", "GB"],
  ["eu-west-3", "FR"],
  ["il-central-1", "IL"],
  ["me-central-1", "AE"],
  ["me-south-1", "BHR"],
  ["mx-central-1", "MX"],
  ["sa-east-1", "BR"],

  // ── Azure ─────────────────────────────────────────────────────────────────
  ["eastus", "US"],
  ["eastus2", "US"],
  ["centralus", "US"],
  ["northcentralus", "US"],
  ["southcentralus", "US"],
  ["westcentralus", "US"],
  ["westus", "US"],
  ["westus2", "US"],
  ["westus3", "US"],
  ["canadacentral", "CA"],
  ["canadaeast", "CA"],
  ["brazilsouth", "BR"],
  ["northeurope", "IE"],
  ["westeurope", "NL"],
  ["uksouth", "GB"],
  ["ukwest", "GB"],
  ["francecentral", "FR"],
  ["francesouth", "FR"],
  ["germanywestcentral", "DE"],
  ["norwayeast", "NO"],
  ["norwaywest", "NO"],
  ["swedencentral", "SE"],
  ["switzerlandnorth", "CH"],
  ["switzerlandwest", "CH"],
  ["polandcentral", "PL"],
  ["italynorth", "IT"],
  ["spaincentral", "ES"],
  ["uaenorth", "AE"],
  ["uaecentral", "AE"],
  ["qatarcentral", "QAT"],
  ["israelcentral", "IL"],
  ["southafricanorth", "ZA"],
  ["southafricawest", "ZA"],
  ["australiaeast", "AU"],
  ["australiasoutheast", "AU"],
  ["australiacentral", "AU"],
  ["australiacentral2", "AU"],
  ["centralindia", "IN"],
  ["southindia", "IN"],
  ["westindia", "IN"],
  ["japaneast", "JP"],
  ["japanwest", "JP"],
  ["koreacentral", "KR"],
  ["koreasouth", "KR"],
  ["southeastasia", "SG"],
  ["eastasia", "HK"],
  ["indonesiacentral", "ID"],
  ["malaysiawest", "MY"],
  ["newzealandnorth", "NZ"],
  ["chilecentral", "CL"],
  ["mexicocentral", "MX"],

  // ── Vercel ────────────────────────────────────────────────────────────────
  //
  // Vercel sets VERCEL_REGION in the function runtime, so an instrumented app
  // hosted there can pass its region without anyone configuring anything. These
  // codes are short and provider-specific — `cle1` is not a country code and
  // never resolves by any other route, so without this block every Vercel-hosted
  // caller reports the global average.
  ["arn1", "SE"], // Stockholm
  ["bom1", "IN"], // Mumbai
  ["cdg1", "FR"], // Paris
  ["cle1", "US"], // Cleveland
  ["cpt1", "ZA"], // Cape Town
  ["dub1", "IE"], // Dublin
  ["fra1", "DE"], // Frankfurt
  ["gru1", "BR"], // Sao Paulo
  ["hkg1", "HK"], // Hong Kong
  ["hnd1", "JP"], // Tokyo
  ["iad1", "US"], // Washington DC — the default, so the most common of all
  ["icn1", "KR"], // Seoul
  ["kix1", "JP"], // Osaka
  ["lhr1", "GB"], // London
  ["pdx1", "US"], // Portland
  ["sfo1", "US"], // San Francisco
  ["sin1", "SG"], // Singapore
  ["syd1", "AU"], // Sydney
]);

/** How many provider region codes we recognise. Asserted in the tests. */
export const CLOUD_REGION_COUNT = CLOUD_REGIONS.size;

/**
 * Resolve a provider region code to a grid zone, or undefined if unrecognised.
 *
 * Undefined is meaningful and must not be swallowed: it is the difference
 * between "this workload runs in Ireland" and "we have no idea where this
 * workload runs", and the caller is obliged to disclose the second.
 */
export function zoneForCloudRegion(region: string): string | undefined {
  return CLOUD_REGIONS.get(region.trim().toLowerCase());
}
