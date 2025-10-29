import { onRequestPost as __api_generate_milestones_ts_onRequestPost } from "/Users/biancadouroudis/Downloads/PlanPoint3-ELEC5620/web/functions/api/generate-milestones.ts"

export const routes = [
    {
      routePath: "/api/generate-milestones",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_generate_milestones_ts_onRequestPost],
    },
  ]