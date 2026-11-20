import { utcMonth, utcMonthStart } from "@sequoia-leaf/core";

import type { Conversion } from "./store.ts";

/** Where a waiting claim stands: the month whose allowance pays it, and its place in its kind's queue from 1. */
export interface Standing {
  readonly month: number;
  readonly position: number;
}

function iso(at: number): string {
  return new Date(at).toISOString();
}

/** A claim as the API sends it to the member who made it, in every answer and event that carries one. */
export function conversionJson(conversion: Conversion, standing: Standing | undefined, now: number) {
  const pending = conversion.status === "pending" ? standing : undefined;
  const dueMonth = pending?.month ?? conversion.paidMonth;
  return {
    id: conversion.id,
    kind: conversion.kind,
    count: conversion.units,
    leaf: conversion.leaf,
    note: conversion.note,
    status: conversion.status,
    requested_at: iso(conversion.createdAt),
    due_from: dueMonth === null ? null : iso(utcMonthStart(dueMonth)),
    due: pending !== undefined && pending.month <= utcMonth(now),
    position: pending?.position ?? null,
    closed_at: conversion.closedAt === null ? null : iso(conversion.closedAt),
    decline_reason: conversion.status === "declined" ? conversion.closeNote : null,
  };
}

/** A claim as staff see it: with who made it, by the name they pay in-game. */
export function staffConversionJson(conversion: Conversion, standing: Standing | undefined, now: number) {
  return {
    ...conversionJson(conversion, standing, now),
    player: { player_id: conversion.playerId, name: conversion.username },
  };
}
