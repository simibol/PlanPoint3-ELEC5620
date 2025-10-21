import { onRequestPost as __api_generate_milestones_ts_onRequestPost } from "/Users/samkertesz/Documents/Uni Y4 S2/ELEC5620/CODE/PlanPoint3-ELEC5620/web/functions/api/generate-milestones.ts"

export const routes = [
    {
      routePath: "/api/generate-milestones",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_generate_milestones_ts_onRequestPost],
    },
  ]