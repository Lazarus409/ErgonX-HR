/**
 * Organisation structure service: departments, positions, grades, locations.
 *
 * All four are standard tenant-scoped router resources under `/api/v1/`.
 * Deletes are soft (`is_active = false`) on the backend.
 */

import { apiDelete, apiGetList, apiGet, apiPatch, apiPost } from "./client";
import { MAX_PAGE_SIZE } from "@/types/api";
import type { ListParams, PaginatedData } from "@/types/api";
import type { Department, Grade, Location, Position } from "@/types/hr";

/* Departments -------------------------------------------------------------- */

export async function listDepartments(
  params?: ListParams,
): Promise<PaginatedData<Department>> {
  return apiGetList<Department>("/departments/", params);
}

export async function getDepartment(id: string): Promise<Department> {
  return apiGet<Department>(`/departments/${id}/`);
}

export async function createDepartment(
  payload: Partial<Department>,
): Promise<Department> {
  return apiPost<Department, Partial<Department>>("/departments/", payload);
}

export async function updateDepartment(
  id: string,
  payload: Partial<Department>,
): Promise<Department> {
  return apiPatch<Department, Partial<Department>>(
    `/departments/${id}/`,
    payload,
  );
}

export async function deleteDepartment(id: string): Promise<void> {
  return apiDelete(`/departments/${id}/`);
}

/* Positions ---------------------------------------------------------------- */

export async function listPositions(
  params?: ListParams,
): Promise<PaginatedData<Position>> {
  return apiGetList<Position>("/positions/", params);
}

export async function getPosition(id: string): Promise<Position> {
  return apiGet<Position>(`/positions/${id}/`);
}

export async function createPosition(
  payload: Partial<Position>,
): Promise<Position> {
  return apiPost<Position, Partial<Position>>("/positions/", payload);
}

export async function updatePosition(
  id: string,
  payload: Partial<Position>,
): Promise<Position> {
  return apiPatch<Position, Partial<Position>>(`/positions/${id}/`, payload);
}

export async function deletePosition(id: string): Promise<void> {
  return apiDelete(`/positions/${id}/`);
}

/* Grades ------------------------------------------------------------------- */

export async function listGrades(
  params?: ListParams,
): Promise<PaginatedData<Grade>> {
  return apiGetList<Grade>("/grades/", params);
}

export async function getGrade(id: string): Promise<Grade> {
  return apiGet<Grade>(`/grades/${id}/`);
}

export async function createGrade(payload: Partial<Grade>): Promise<Grade> {
  return apiPost<Grade, Partial<Grade>>("/grades/", payload);
}

export async function updateGrade(
  id: string,
  payload: Partial<Grade>,
): Promise<Grade> {
  return apiPatch<Grade, Partial<Grade>>(`/grades/${id}/`, payload);
}

export async function deleteGrade(id: string): Promise<void> {
  return apiDelete(`/grades/${id}/`);
}

/* Locations ---------------------------------------------------------------- */

export async function listLocations(
  params?: ListParams,
): Promise<PaginatedData<Location>> {
  return apiGetList<Location>("/locations/", params);
}

export async function getLocation(id: string): Promise<Location> {
  return apiGet<Location>(`/locations/${id}/`);
}

export async function createLocation(
  payload: Partial<Location>,
): Promise<Location> {
  return apiPost<Location, Partial<Location>>("/locations/", payload);
}

export async function updateLocation(
  id: string,
  payload: Partial<Location>,
): Promise<Location> {
  return apiPatch<Location, Partial<Location>>(`/locations/${id}/`, payload);
}

export async function deleteLocation(id: string): Promise<void> {
  return apiDelete(`/locations/${id}/`);
}

/* Lookups ------------------------------------------------------------------ */

export interface OrganizationLookups {
  departments: Department[];
  positions: Position[];
  grades: Grade[];
  locations: Location[];
}

/**
 * Loads the reference data used by employee filters and forms in one pass.
 * Capped at the backend's maximum page size; larger structures would need a
 * paged picker rather than a flat select.
 */
export async function loadOrganizationLookups(): Promise<OrganizationLookups> {
  const params: ListParams = { page_size: MAX_PAGE_SIZE, ordering: "name" };

  const [departments, positions, grades, locations] = await Promise.all([
    listDepartments(params),
    listPositions({ page_size: MAX_PAGE_SIZE, ordering: "title" }),
    listGrades(params),
    listLocations(params),
  ]);

  return {
    departments: departments.results,
    positions: positions.results,
    grades: grades.results,
    locations: locations.results,
  };
}
