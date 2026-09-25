import { test, expect } from "@playwright/test";

test("local Battleship launches both seats and accepts their placements", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => { errors.push(error.message); console.error("Battleship page error:", error.message); });
  await page.goto("/src/pages/merkle-battleship/");
  await page.getByTestId("mb-local").click();
  for (const playerID of ["0", "1"]) {
    const seat = page.getByRole("region", { name: `Player ${playerID}`, exact: true });
    await seat.getByRole("button", { name: "Randomize", exact: true }).click();
    const confirm = seat.getByRole("button", { name: "Confirm Placement", exact: true });
    await expect(confirm).toBeEnabled();
    await confirm.click();
    if (playerID === "0") {
      await expect(seat.getByText("Commitment root:", { exact: false })).toBeVisible();
    }
  }
  for (const playerID of ["0", "1"]) {
    await expect(page.getByRole("region", { name: `Player ${playerID}`, exact: true }))
      .toContainText("Phase: battle");
  }
  await expect(page.getByText("Your turn. Click a cell on the opponent grid.", { exact: true }))
    .toHaveCount(1);
  await expect(page.getByText("Waiting for opponent…", { exact: true })).toHaveCount(1);
  expect(errors).toEqual([]);
});


test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    console.error("Local seat status:", await page.getByRole("region").allTextContents());
  }
});
