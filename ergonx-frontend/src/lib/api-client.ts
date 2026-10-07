/**
 * @deprecated Superseded by `@/lib/api`.
 *
 * Kept as a thin re-export so there is exactly one configured Axios instance
 * in the application. Import from `@/lib/api` in new code.
 */

export {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  getApiErrorMessage,
} from "./api/client";

export { default } from "./api/client";
