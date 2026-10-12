/** Bounded provider catalog, not trust learned from links or redirects. */
export const surveyHostRules = [
  "*.qualtrics.com",
  "*.qualtrics.eu",
  "*.qsurvey.io",
  "*.surveymonkey.com",
  "*.alchemer.com",
  "*.surveygizmo.com",
  "*.decipherinc.com",
  "*.focusvision.com",
  "*.forsta.com",
  "*.confirmit.com",
  "*.confirmit.eu",
  "*.selfdecipher.com",
  "*.surveys.com",
  "*.samplicio.us",
  "*.lucidhq.com",
  "*.cint.com",
  "*.cintlink.com",
  "*.spectrumsurveys.com",
  "*.surveyrouter.com",
  "*.sample-cube.com",
  "*.samplecube.com",
  "*.surveytools.com",
  "*.researchsurv.com",
  "*.dynata.com",
  "*.ssisurveys.com",
  "*.i-say.com",
  "*.ipsosinteractive.com",
  "*.yougov.com",
  "*.toluna.com",
  "*.labvanced.com",
  "*.gorilla.sc",
  "*.pavlovia.org",
  "*.cognition.run",
  "*.run.pavlovia.org",
  "*.research.sc",
  "*.typeform.com",
  "*.jotform.com",
  "*.questionpro.com",
  "*.survio.com",
  "*.surveyengine.com",
  "*.psychstudio.com"
] as const;
export function effectiveSurveyDomains(settings: {
  allowedDomains: readonly string[];
  platform: string;
  surveyHostCatalog: boolean;
}): string[] {
  return [
    ...new Set([
      ...settings.allowedDomains,
      ...(settings.surveyHostCatalog && settings.platform !== "generic" ? surveyHostRules : [])
    ])
  ];
}
