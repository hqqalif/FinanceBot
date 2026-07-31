import type { Pool } from "pg";

import type {
  LedgerRepository,
  LedgerTransaction,
  RecordExpenseInput,
  RecordExpenseResult,
  WalletBalance,
} from "../../domain/ledger/LedgerRepository.js";

type TransactionRow = { id: string };
type BalanceRow = {
  wallet_id: string;
  currency: string;
  opening_balance_minor: string;
  expense_total_minor: string;
};
type LedgerTransactionRow = {
  occurred_at: Date;
  category_name: string | null;
  description: string;
  amount_minor: string;
  transaction_type: LedgerTransaction["transactionType"];
};

export class PostgresLedgerRepository implements LedgerRepository {
  public constructor(private readonly pool: Pool) {}

  public async setOpeningBalance(
    userWhatsAppId: string,
    currency: string,
    amountMinor: bigint,
  ): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const userResult = await client.query<{ id: string }>(
        `INSERT INTO users (whatsapp_id)
         VALUES ($1)
         ON CONFLICT (whatsapp_id) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [userWhatsAppId],
      );

      await client.query(
        `INSERT INTO wallets (user_id, currency, opening_balance_minor)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, currency)
         DO UPDATE SET opening_balance_minor = EXCLUDED.opening_balance_minor, updated_at = NOW()`,
        [userResult.rows[0].id, currency, amountMinor.toString()],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async addFunds(
    userWhatsAppId: string,
    currency: string,
    amountMinor: bigint,
    sourceMessageId: string,
  ): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const userResult = await client.query<{ id: string }>(
        `INSERT INTO users (whatsapp_id)
         VALUES ($1)
         ON CONFLICT (whatsapp_id) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [userWhatsAppId],
      );
      const userId = userResult.rows[0].id;

      const walletResult = await client.query<{ id: string }>(
        `INSERT INTO wallets (user_id, currency, opening_balance_minor)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, currency)
         DO UPDATE SET opening_balance_minor = wallets.opening_balance_minor + EXCLUDED.opening_balance_minor, updated_at = NOW()
         RETURNING id`,
        [userId, currency, amountMinor.toString()],
      );

      await client.query(
        `INSERT INTO transactions
           (user_id, wallet_id, category_id, source_message_id, transaction_type, description, amount_minor, occurred_at)
         VALUES ($1, $2, NULL, $3, 'income', 'Top up', $4, NOW())
         ON CONFLICT (source_message_id) DO NOTHING`,
        [userId, walletResult.rows[0].id, sourceMessageId, amountMinor.toString()],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async recordExpense(input: RecordExpenseInput): Promise<RecordExpenseResult> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const userResult = await client.query<{ id: string }>(
        `INSERT INTO users (whatsapp_id)
         VALUES ($1)
         ON CONFLICT (whatsapp_id) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [input.userWhatsAppId],
      );
      const userId = userResult.rows[0].id;

      const walletResult = await client.query<{ id: string }>(
        `INSERT INTO wallets (user_id, currency, opening_balance_minor)
         VALUES ($1, $2, 0)
         ON CONFLICT (user_id, currency) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [userId, input.walletCurrency],
      );
      const walletId = walletResult.rows[0].id;

      const categoryResult = await client.query<{ id: string }>(
        `INSERT INTO categories (user_id, name)
         VALUES ($1, $2)
         ON CONFLICT (user_id, normalized_name) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [userId, input.categoryName],
      );

      const transactionResult = await client.query<TransactionRow>(
        `INSERT INTO transactions
           (user_id, wallet_id, category_id, source_message_id, transaction_type, description, amount_minor, occurred_at)
         VALUES ($1, $2, $3, $4, 'expense', $5, $6, $7)
         ON CONFLICT (source_message_id) DO NOTHING
         RETURNING id`,
        [
          userId,
          walletId,
          categoryResult.rows[0].id,
          input.sourceMessageId,
          input.description,
          input.amountMinor.toString(),
          input.occurredAt,
        ],
      );

      if (transactionResult.rowCount === 0) {
        const existingTransaction = await client.query<TransactionRow>(
          "SELECT id FROM transactions WHERE source_message_id = $1",
          [input.sourceMessageId],
        );
        await client.query("COMMIT");
        return { created: false, transactionId: existingTransaction.rows[0].id };
      }

      await client.query("COMMIT");
      return { created: true, transactionId: transactionResult.rows[0].id };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async getBalances(userWhatsAppId: string): Promise<WalletBalance[]> {
    const result = await this.pool.query<BalanceRow>(
      `SELECT
         wallets.id AS wallet_id,
         wallets.currency,
         wallets.opening_balance_minor,
         COALESCE(SUM(transactions.amount_minor) FILTER (WHERE transactions.transaction_type = 'expense'), 0) AS expense_total_minor
       FROM wallets
       JOIN users ON users.id = wallets.user_id
       LEFT JOIN transactions ON transactions.wallet_id = wallets.id AND transactions.status = 'approved'
       WHERE users.whatsapp_id = $1
       GROUP BY wallets.id
       ORDER BY wallets.currency`,
      [userWhatsAppId],
    );

    return result.rows.map((row) => {
      const openingBalanceMinor = BigInt(row.opening_balance_minor);
      const expenseTotalMinor = BigInt(row.expense_total_minor);
      return {
        walletId: row.wallet_id,
        currency: row.currency,
        openingBalanceMinor,
        expenseTotalMinor,
        currentBalanceMinor: openingBalanceMinor - expenseTotalMinor,
      };
    });
  }

  public async deleteWallet(userWhatsAppId: string, currency: string): Promise<boolean> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const walletResult = await client.query<{ id: string }>(
        `SELECT wallets.id
         FROM wallets
         JOIN users ON users.id = wallets.user_id
         WHERE users.whatsapp_id = $1 AND wallets.currency = $2`,
        [userWhatsAppId, currency],
      );

      if (walletResult.rowCount === 0) {
        await client.query("ROLLBACK");
        return false;
      }

      const walletId = walletResult.rows[0].id;
      await client.query("DELETE FROM transactions WHERE wallet_id = $1", [walletId]);
      await client.query("DELETE FROM wallets WHERE id = $1", [walletId]);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async listTransactionsInRange(
    userWhatsAppId: string,
    currency: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<LedgerTransaction[]> {
    const result = await this.pool.query<LedgerTransactionRow>(
      `SELECT
         transactions.occurred_at,
         categories.name AS category_name,
         transactions.description,
         transactions.amount_minor,
         transactions.transaction_type
       FROM transactions
       JOIN wallets ON wallets.id = transactions.wallet_id
       JOIN users ON users.id = wallets.user_id
       LEFT JOIN categories ON categories.id = transactions.category_id
       WHERE users.whatsapp_id = $1
         AND wallets.currency = $2
         AND transactions.status = 'approved'
         AND transactions.occurred_at BETWEEN $3 AND $4
       ORDER BY transactions.occurred_at ASC`,
      [userWhatsAppId, currency, periodStart, periodEnd],
    );

    return result.rows.map((row) => ({
      occurredAt: row.occurred_at,
      categoryName: row.category_name,
      description: row.description,
      amountMinor: BigInt(row.amount_minor),
      transactionType: row.transaction_type,
    }));
  }
}