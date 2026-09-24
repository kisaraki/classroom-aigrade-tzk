import { env } from "cloudflare:workers";
import { authService } from "../auth/runtime.ts";
import { AuthError } from "../auth/types.ts";
import { ExamService } from "./service.ts";
import {
  examHttpError,
  handleExamRequest,
  type ExamOperation,
} from "./http.ts";

export async function examRoute(
  request: Request,
  operation: ExamOperation,
  id?: string,
) {
  try {
    if (!env.DB) throw new AuthError("AUTH_DATABASE_UNAVAILABLE", 503);
    return await handleExamRequest(
      request,
      { auth: authService(), exams: new ExamService({ db: env.DB }) },
      operation,
      id,
    );
  } catch (error) {
    return examHttpError(error);
  }
}
