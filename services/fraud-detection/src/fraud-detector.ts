import { Logger } from './logger';

interface FraudAlert {
  id: string;
  transactionId: string;
  customerId: string;
  alertType: 'velocity' | 'amount' | 'pattern' | 'location' | 'device';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  timestamp: string;
  resolved: boolean;
  falsePositive: boolean;
}

interface CustomerFraudProfile {
  customerId: string;
  totalAlerts: number;
  highRiskTransactions: number;
  suspiciousPatterns: string[];
  lastFraudCheck: string;
  fraudScore: number;
  whiteListed: boolean;
}

export class FraudDetector {
  private logger: Logger;
  private fraudAlerts: Map<string, FraudAlert> = new Map();
  private customerProfiles: Map<string, CustomerFraudProfile> = new Map();
  private transactionHistory: Map<string, any[]> = new Map();

  constructor(logger: Logger) {
    this.logger = logger;
  }

  // This method processes transaction attempts and looks for fraud patterns
  async analyzeTransaction(logData: any): Promise<void> {
    try {
      // CRITICAL: This depends on specific metadata structure and transaction classification
      // After refactor, the transaction classification logic changes and breaks this
      if (logData.event !== 'transaction_attempt') {
        return;
      }

      const customerId = logData.customerId;
      const amount = logData.amount;
      const timestamp = logData.timestamp;

      // Get customer's transaction history
      const history = this.transactionHistory.get(customerId) || [];
      history.push({
        amount,
        timestamp,
        paymentMethod: logData.metadata?.paymentMethod,
        ipAddress: logData.metadata?.ipAddress,
        userAgent: logData.metadata?.userAgent
      });
      this.transactionHistory.set(customerId, history);

      // Run fraud detection algorithms
      await this.checkVelocityFraud(customerId, amount, timestamp);
      await this.checkAmountFraud(customerId, amount);
      await this.checkPatternFraud(customerId, logData.metadata);
      await this.checkLocationFraud(customerId, logData.metadata?.ipAddress);

      // Update customer fraud profile
      await this.updateFraudProfile(customerId);

      this.logger.info('Fraud analysis completed', {
        customerId,
        amount,
        timestamp
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Fraud analysis failed', {
        error: errorMessage,
        logData
      });
    }
  }

  private async checkVelocityFraud(customerId: string, amount: number, timestamp: string): Promise<void> {
    const history = this.transactionHistory.get(customerId) || [];
    const now = new Date(timestamp).getTime();
    const oneHour = 60 * 60 * 1000;
    const oneDay = 24 * oneHour;

    // Check transactions in last hour
    const recentTransactions = history.filter(t => 
      now - new Date(t.timestamp).getTime() < oneHour
    );

    // Check transactions in last day
    const dailyTransactions = history.filter(t => 
      now - new Date(t.timestamp).getTime() < oneDay
    );

    // Velocity rules
    if (recentTransactions.length > 5) {
      await this.createFraudAlert(customerId, 'velocity', 'high', 
        `${recentTransactions.length} transactions in last hour`);
    }

    if (dailyTransactions.length > 20) {
      await this.createFraudAlert(customerId, 'velocity', 'medium', 
        `${dailyTransactions.length} transactions in last day`);
    }

    const hourlyAmount = recentTransactions.reduce((sum, t) => sum + t.amount, 0);
    if (hourlyAmount > 100000) { // $1000 in an hour
      await this.createFraudAlert(customerId, 'velocity', 'critical', 
        `$${hourlyAmount/100} in transactions within hour`);
    }
  }

  private async checkAmountFraud(customerId: string, amount: number): Promise<void> {
    const history = this.transactionHistory.get(customerId) || [];
    
    if (history.length === 0) return;

    const averageAmount = history.reduce((sum, t) => sum + t.amount, 0) / history.length;
    
    // Amount significantly higher than usual
    if (amount > averageAmount * 10 && amount > 50000) { // 10x average and >$500
      await this.createFraudAlert(customerId, 'amount', 'high', 
        `Transaction amount $${amount/100} is ${Math.round(amount/averageAmount)}x customer average`);
    }

    // Very large transaction
    if (amount > 500000) { // $5000
      await this.createFraudAlert(customerId, 'amount', 'medium', 
        `Large transaction amount: $${amount/100}`);
    }
  }

  private async checkPatternFraud(customerId: string, metadata: any): Promise<void> {
    const history = this.transactionHistory.get(customerId) || [];
    
    if (history.length < 3) return;

    // Check for rapid payment method switching
    const recentMethods = history.slice(-5).map(t => t.paymentMethod);
    const uniqueMethods = new Set(recentMethods).size;
    
    if (uniqueMethods >= 3) {
      await this.createFraudAlert(customerId, 'pattern', 'medium', 
        `Rapid payment method switching: ${uniqueMethods} methods in recent transactions`);
    }

    // Check for unusual user agent patterns
    const recentUserAgents = history.slice(-10).map(t => t.userAgent).filter(Boolean);
    const uniqueUserAgents = new Set(recentUserAgents).size;
    
    if (uniqueUserAgents >= 4) {
      await this.createFraudAlert(customerId, 'device', 'medium', 
        `Multiple devices detected: ${uniqueUserAgents} different user agents`);
    }
  }

  private async checkLocationFraud(customerId: string, ipAddress: string): Promise<void> {
    if (!ipAddress) return;

    const history = this.transactionHistory.get(customerId) || [];
    const recentIPs = history.slice(-10).map(t => t.ipAddress).filter(Boolean);
    
    // Simple IP-based location check (in real world, would use geolocation service)
    const ipPrefixes = recentIPs.map(ip => ip.split('.').slice(0, 2).join('.'));
    const uniquePrefixes = new Set(ipPrefixes).size;
    
    if (uniquePrefixes >= 3) {
      await this.createFraudAlert(customerId, 'location', 'medium', 
        `Multiple locations detected: ${uniquePrefixes} different IP ranges`);
    }
  }

  private async createFraudAlert(
    customerId: string, 
    alertType: FraudAlert['alertType'], 
    severity: FraudAlert['severity'], 
    description: string,
    transactionId: string = `tmp_${Date.now()}`
  ): Promise<void> {
    const alertId = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const alert: FraudAlert = {
      id: alertId,
      transactionId,
      customerId,
      alertType,
      severity,
      description,
      timestamp: new Date().toISOString(),
      resolved: false,
      falsePositive: false
    };

    this.fraudAlerts.set(alertId, alert);

    this.logger.warn('Fraud alert created', {
      alertId,
      customerId,
      alertType,
      severity,
      description
    });

    // Auto-block high severity alerts
    if (severity === 'critical') {
      this.logger.error('CRITICAL FRAUD ALERT - BLOCKING CUSTOMER', {
        customerId,
        alertId,
        description
      });
    }
  }

  private async updateFraudProfile(customerId: string): Promise<void> {
    const alerts = Array.from(this.fraudAlerts.values()).filter(a => a.customerId === customerId);
    const highRiskAlerts = alerts.filter(a => a.severity === 'high' || a.severity === 'critical');
    
    const profile: CustomerFraudProfile = {
      customerId,
      totalAlerts: alerts.length,
      highRiskTransactions: highRiskAlerts.length,
      suspiciousPatterns: [...new Set(alerts.map(a => a.alertType))],
      lastFraudCheck: new Date().toISOString(),
      fraudScore: this.calculateFraudScore(alerts),
      whiteListed: false
    };

    this.customerProfiles.set(customerId, profile);
  }

  private calculateFraudScore(alerts: FraudAlert[]): number {
    let score = 0;
    
    alerts.forEach(alert => {
      switch (alert.severity) {
        case 'critical': score += 50; break;
        case 'high': score += 25; break;
        case 'medium': score += 10; break;
        case 'low': score += 5; break;
      }
    });

    return Math.min(score, 100); // Cap at 100
  }

  async getFraudAlerts(customerId?: string): Promise<FraudAlert[]> {
    const alerts = Array.from(this.fraudAlerts.values());
    return customerId ? alerts.filter(a => a.customerId === customerId) : alerts;
  }

  async getCustomerFraudProfile(customerId: string): Promise<CustomerFraudProfile | undefined> {
    return this.customerProfiles.get(customerId);
  }

  async resolveAlert(alertId: string, falsePositive: boolean = false): Promise<void> {
    const alert = this.fraudAlerts.get(alertId);
    if (alert) {
      alert.resolved = true;
      alert.falsePositive = falsePositive;
      this.fraudAlerts.set(alertId, alert);
      
      this.logger.info('Fraud alert resolved', {
        alertId,
        falsePositive
      });
    }
  }
} 