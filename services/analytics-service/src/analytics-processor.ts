import { Logger } from './logger';

interface TransactionAnalytics {
  transactionId: string;
  customerId: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  timestamp: string;
  processingTime?: number;
  riskScore?: number;
  deviceInfo?: any;
  geolocation?: string;
}

interface CustomerAnalytics {
  customerId: string;
  totalTransactions: number;
  totalAmount: number;
  averageTransactionAmount: number;
  paymentMethodPreferences: Record<string, number>;
  transactionTrends: Array<{ date: string; amount: number; count: number }>;
  riskProfile: 'low' | 'medium' | 'high';
  lastActivity: string;
}

export class AnalyticsProcessor {
  private logger: Logger;
  private transactionAnalytics: Map<string, TransactionAnalytics> = new Map();
  private customerAnalytics: Map<string, CustomerAnalytics> = new Map();

  constructor(logger: Logger) {
    this.logger = logger;
  }

  // This method processes AUDIT logs from transaction-handler
  async processTransactionAttempt(logData: any): Promise<void> {
    try {
      // CRITICAL: This depends on the exact metadata structure in the AUDIT log
      // The refactor will change how metadata is structured, breaking this silently
      if (logData.event !== 'transaction_attempt') {
        return;
      }

      // Extract analytics data from the log metadata
      const analyticsData: TransactionAnalytics = {
        transactionId: logData.transactionId || `tmp_${Date.now()}`,
        customerId: logData.customerId,
        amount: logData.amount,
        currency: logData.currency,
        paymentMethod: logData.metadata?.paymentMethod || 'unknown',
        timestamp: logData.timestamp,
        deviceInfo: {
          userAgent: logData.metadata?.userAgent,
          ipAddress: logData.metadata?.ipAddress
        }
      };

      // Store transaction analytics
      this.transactionAnalytics.set(analyticsData.transactionId, analyticsData);

      // Update customer analytics
      await this.updateCustomerAnalytics(analyticsData);

      this.logger.info('Transaction analytics recorded', {
        transactionId: analyticsData.transactionId,
        customerId: analyticsData.customerId
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to process transaction analytics', {
        error: errorMessage,
        logData
      });
    }
  }

  async processTransactionCompletion(logData: any): Promise<void> {
    try {
      if (logData.event !== 'transaction_completed') {
        return;
      }

      // Update existing analytics record with completion data
      const existing = this.transactionAnalytics.get(logData.transactionId);
      if (existing) {
        existing.processingTime = Date.now() - new Date(existing.timestamp).getTime();
        this.transactionAnalytics.set(logData.transactionId, existing);
      }

      // Calculate risk score based on transaction patterns
      await this.calculateRiskScore(logData.customerId);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to process transaction completion analytics', {
        error: errorMessage,
        logData
      });
    }
  }

  private async updateCustomerAnalytics(transactionData: TransactionAnalytics): Promise<void> {
    const customerId = transactionData.customerId;
    const existing = this.customerAnalytics.get(customerId) || {
      customerId,
      totalTransactions: 0,
      totalAmount: 0,
      averageTransactionAmount: 0,
      paymentMethodPreferences: {},
      transactionTrends: [],
      riskProfile: 'low' as const,
      lastActivity: transactionData.timestamp
    };

    existing.totalTransactions += 1;
    existing.totalAmount += transactionData.amount;
    existing.averageTransactionAmount = existing.totalAmount / existing.totalTransactions;
    existing.lastActivity = transactionData.timestamp;

    // Update payment method preferences
    const paymentMethod = transactionData.paymentMethod;
    existing.paymentMethodPreferences[paymentMethod] = 
      (existing.paymentMethodPreferences[paymentMethod] || 0) + 1;

    // Update transaction trends (daily aggregation)
    const today = new Date().toISOString().split('T')[0];
    const todayTrend = existing.transactionTrends.find(t => t.date === today);
    if (todayTrend) {
      todayTrend.amount += transactionData.amount;
      todayTrend.count += 1;
    } else {
      existing.transactionTrends.push({
        date: today,
        amount: transactionData.amount,
        count: 1
      });
    }

    // Keep only last 30 days of trends
    existing.transactionTrends = existing.transactionTrends
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 30);

    this.customerAnalytics.set(customerId, existing);
  }

  private async calculateRiskScore(customerId: string): Promise<void> {
    const customer = this.customerAnalytics.get(customerId);
    if (!customer) return;

    // Simple risk calculation based on transaction patterns
    let riskScore = 0;

    // High frequency in short time = higher risk
    const recentTransactions = customer.transactionTrends.slice(0, 7);
    const avgDailyTransactions = recentTransactions.reduce((sum, t) => sum + t.count, 0) / 7;
    if (avgDailyTransactions > 10) riskScore += 30;

    // Large amounts = higher risk
    if (customer.averageTransactionAmount > 50000) riskScore += 25; // $500+

    // Multiple payment methods = potentially higher risk
    const methodCount = Object.keys(customer.paymentMethodPreferences).length;
    if (methodCount > 3) riskScore += 20;

    // Update risk profile
    if (riskScore > 50) {
      customer.riskProfile = 'high';
    } else if (riskScore > 25) {
      customer.riskProfile = 'medium';
    } else {
      customer.riskProfile = 'low';
    }

    this.customerAnalytics.set(customerId, customer);

    this.logger.info('Risk score calculated', {
      customerId,
      riskScore,
      riskProfile: customer.riskProfile
    });
  }

  async getCustomerAnalytics(customerId: string): Promise<CustomerAnalytics | undefined> {
    return this.customerAnalytics.get(customerId);
  }

  async getTransactionAnalytics(transactionId: string): Promise<TransactionAnalytics | undefined> {
    return this.transactionAnalytics.get(transactionId);
  }

  async getHighRiskCustomers(): Promise<CustomerAnalytics[]> {
    return Array.from(this.customerAnalytics.values()).filter(c => c.riskProfile === 'high');
  }
} 