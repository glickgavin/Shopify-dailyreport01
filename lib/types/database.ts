export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      daily_summary: {
        Row: {
          date: string;
          total_revenue: number;
          total_net_sales: number;
          total_shipping: number;
          total_cogs: number;
          total_profit: number;
          total_margin: number;
          total_orders: number;
          total_qty: number;
          total_aov: number;
          phys_cash_revenue: number;
          phys_cash_net_sales: number;
          phys_cash_shipping: number;
          phys_cash_cogs: number;
          phys_cash_profit: number;
          phys_cash_margin: number;
          phys_cash_orders: number;
          phys_cash_qty: number;
          phys_cash_aov: number;
          phys_non_cash_revenue: number;
          phys_non_cash_net_sales: number;
          phys_non_cash_shipping: number;
          phys_non_cash_cogs: number;
          phys_non_cash_profit: number;
          phys_non_cash_margin: number;
          phys_non_cash_orders: number;
          phys_non_cash_qty: number;
          phys_non_cash_aov: number;
          mem_revenue: number;
          mem_net_sales: number;
          mem_shipping: number;
          mem_cogs: number;
          mem_profit: number;
          mem_margin: number;
          mem_orders: number;
          mem_qty: number;
          mem_aov: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['daily_summary']['Row'], 'created_at' | 'updated_at'> & {
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['daily_summary']['Insert']>;
      };
      daily_products: {
        Row: {
          id: number;
          date: string;
          title: string;
          variant: string;
          item_type: 'Physical' | 'Membership';
          net_sales: number;
          shipping: number;
          cogs: number;
          revenue: number;
          qty: number;
          orders: number;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['daily_products']['Row'], 'id' | 'created_at'> & {
          id?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['daily_products']['Insert']>;
      };
      daily_membership_orders: {
        Row: {
          id: number;
          date: string;
          order_name: string;
          membership_type: 'new' | 'recurring';
          net_sales: number;
          shipping: number;
          revenue: number;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['daily_membership_orders']['Row'], 'id' | 'created_at'> & {
          id?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['daily_membership_orders']['Insert']>;
      };
      raw_data: {
        Row: {
          id: number;
          date: string;
          fetched_at: string;
          order_rows: Json;
          payment_rows: Json;
        };
        Insert: Omit<Database['public']['Tables']['raw_data']['Row'], 'id' | 'fetched_at'> & {
          id?: number;
          fetched_at?: string;
        };
        Update: Partial<Database['public']['Tables']['raw_data']['Insert']>;
      };
      job_logs: {
        Row: {
          id: number;
          date: string | null;
          job_type: string;
          status: 'started' | 'success' | 'error';
          message: string | null;
          meta: Json | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['job_logs']['Row'], 'id' | 'created_at'> & {
          id?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['job_logs']['Insert']>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
