export interface LogLevel {
  level: 'info' | 'warn' | 'error' | 'debug';
}

export class Logger {
  private serviceName: string;

  constructor(serviceName: string = 'payment-service') {
    this.serviceName = serviceName;
  }

  info(message: string, metadata?: Record<string, any>): void {
    console.log(JSON.stringify({
      level: 'info',
      service: this.serviceName,
      message,
      timestamp: new Date().toISOString(),
      ...metadata
    }));
  }

  warn(message: string, metadata?: Record<string, any>): void {
    console.warn(JSON.stringify({
      level: 'warn',
      service: this.serviceName,
      message,
      timestamp: new Date().toISOString(),
      ...metadata
    }));
  }

  error(message: string, metadata?: Record<string, any>): void {
    console.error(JSON.stringify({
      level: 'error',
      service: this.serviceName,
      message,
      timestamp: new Date().toISOString(),
      ...metadata
    }));
  }

  debug(message: string, metadata?: Record<string, any>): void {
    console.debug(JSON.stringify({
      level: 'debug',
      service: this.serviceName,
      message,
      timestamp: new Date().toISOString(),
      ...metadata
    }));
  }
} 