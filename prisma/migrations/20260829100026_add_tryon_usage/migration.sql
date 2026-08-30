-- CreateTable
CREATE TABLE "TryOnUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE UNIQUE INDEX "TryOnUsage_shop_month_key" ON "TryOnUsage"("shop", "month");
