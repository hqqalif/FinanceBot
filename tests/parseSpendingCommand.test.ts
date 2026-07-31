import { describe, expect, it } from "vitest";

import {
  parseSpendingCommand,
  SpendingCommandError,
} from "../src/domain/commands/parseSpendingCommand.js";

describe("parseSpendingCommand", () => {
  const fixedCurrency = (currency: string, fractionDigits: number) => ({
    resolveCurrency: () => ({ currency, fractionDigits }),
  });

  it("parses a valid spending message into minor units", () => {
    expect(parseSpendingCommand("Lunch at Makan Sari, Food, 45000.50", fixedCurrency("IDR", 2))).toEqual({
      description: "Lunch at Makan Sari",
      category: "Food",
      amountMinor: 4_500_050n,
      currency: "IDR",
    });
  });

  it("trims the command fields", () => {
    expect(parseSpendingCommand(" Coffee , Drinks , 12 ", fixedCurrency("IDR", 2))).toEqual({
      description: "Coffee",
      category: "Drinks",
      amountMinor: 1_200n,
      currency: "IDR",
    });
  });

  it("uses the configured currency precision", () => {
    expect(parseSpendingCommand("Lunch, Food, 45000", fixedCurrency("IDR", 0))).toEqual({
      description: "Lunch",
      category: "Food",
      amountMinor: 45_000n,
      currency: "IDR",
    });
  });

  it("uses an explicit currency from the message over the resolver default", () => {
    expect(
      parseSpendingCommand("Lunch, Food, 50.50, AUD", {
        resolveCurrency: (explicitCurrency) => ({
          currency: explicitCurrency ?? "IDR",
          fractionDigits: explicitCurrency === "AUD" ? 2 : 0,
        }),
      }),
    ).toEqual({
      description: "Lunch",
      category: "Food",
      amountMinor: 5_050n,
      currency: "AUD",
    });
  });

  it("rejects incomplete commands", () => {
    expect(() => parseSpendingCommand("Lunch, Food", fixedCurrency("IDR", 0))).toThrow(SpendingCommandError);
    expect(() => parseSpendingCommand("Lunch, Food, 0", fixedCurrency("IDR", 0))).toThrow(SpendingCommandError);
  });

  it("rejects invalid decimal precision", () => {
    expect(() => parseSpendingCommand("Lunch, Food, 12.345", fixedCurrency("IDR", 2))).toThrow(
      SpendingCommandError,
    );
    expect(() => parseSpendingCommand("Lunch, Food, 12.50", fixedCurrency("IDR", 0))).toThrow(
      SpendingCommandError,
    );
  });
});