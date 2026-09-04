// Type surface for index.js. Hand-written rather than generated, because this
// package intentionally has no build step — see the header comment in index.js
// for why. It is three exports plus a re-export, so keeping it in sync by hand
// costs far less than the failure mode a build step reintroduces.
import { PrismaClient } from "@prisma/client";

/** The process-wide Prisma client, with pool sizing and slow-query logging applied. */
export declare const prisma: PrismaClient;

/** Verifies the database is reachable. Used by the readiness probe. */
export declare function checkDatabase(): Promise<boolean>;

/** Closes the connection pool during graceful shutdown. */
export declare function disconnectDatabase(): Promise<void>;

export * from "@prisma/client";
