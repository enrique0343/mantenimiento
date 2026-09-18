import type { APIRoute } from "astro";
import { handleSgoRequest } from "../../../../../lib/sgo/handler.mjs";
export const prerender = false;
export const ALL: APIRoute = ({ request, locals }) => handleSgoRequest(request, locals.runtime?.env);
