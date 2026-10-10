export type Platform = "eureka" | "prolific" | "branded";

export const platformPresets = {
  eureka: {
    name: "Eureka",
    url: "https://eurekasurveys.com/surveys",
    hosts: ["eurekasurveys.com", "*.eurekasurveys.com"]
  },
  prolific: {
    name: "Prolific",
    url: "https://app.prolific.com/studies",
    hosts: ["app.prolific.com"]
  },
  branded: {
    name: "Branded Surveys",
    url: "https://surveys.gobranded.com/",
    hosts: ["surveys.gobranded.com"]
  }
} as const;
