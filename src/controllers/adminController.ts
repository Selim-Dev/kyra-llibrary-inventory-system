/**
 * Admin Controller - Handles admin-only HTTP requests
 */

import { Request, Response, NextFunction } from 'express';
import { EventType, EmailType } from '@prisma/client';
import { getEvents } from '../services/eventService';
import { getBalance, getMovements } from '../services/walletService';
import { getEmails } from '../services/emailService';
import { getUserHistory } from '../services/userService';

export class AdminController {
  /**
   * View all events with filters and pagination
   */
  async getEvents(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { userEmail, bookIsbn, type, startDate, endDate, page, pageSize } =
        req.query;

      const result = await getEvents({
        userEmail: userEmail as string | undefined,
        bookIsbn: bookIsbn as string | undefined,
        type: type as EventType | undefined,
        startDate: startDate as string | undefined,
        endDate: endDate as string | undefined,
        page: page as string | undefined,
        pageSize: pageSize as string | undefined,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * View the current wallet balance
   */
  async getWalletBalance(
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const balance = await getBalance();

      res.status(200).json(balance);
    } catch (error) {
      next(error);
    }
  }

  /**
   * View wallet movements with filters and pagination
   */
  async getWalletMovements(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { type, startDate, endDate, page, pageSize } = req.query;

      const result = await getMovements({
        type: type as 'credit' | 'debit' | undefined,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        page: page as string | undefined,
        pageSize: pageSize as string | undefined,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * View simulated emails with filters and pagination
   */
  async getEmails(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { recipient, type, page, pageSize } = req.query;

      const result = await getEmails({
        recipient: recipient as string | undefined,
        type: type as EmailType | undefined,
        page: page as string | undefined,
        pageSize: pageSize as string | undefined,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * View a specific user's borrowing and buying history
   */
  async getUserHistory(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { email } = req.params;

      const result = await getUserHistory(email);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export const adminController = new AdminController();
