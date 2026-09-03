-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "query" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stages" TEXT NOT NULL,
    "verdict" TEXT,
    "usage" TEXT NOT NULL,
    "error" TEXT,
    "elapsedMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
