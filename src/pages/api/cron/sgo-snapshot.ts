import type { APIRoute } from "astro";
import { handleSnapshotPublish } from "../../../lib/sgo/handler.mjs";
export const prerender = false;
export const ALL: APIRoute = ({ request, locals }) => handleSnapshotPublish(request, locals.runtime?.env);
