export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
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
        Insert: {
          date: string;
          total_revenue?: number | null;
          total_net_sales?: number | null;
          total_shipping?: number | null;
          total_cogs?: number | null;
          total_profit?: number | null;
          total_margin?: number | null;
          total_orders?: number | null;
          total_qty?: number | null;
          total_aov?: number | null;
          phys_cash_revenue?: number | null;
          phys_cash_net_sales?: number | null;
          phys_cash_shipping?: number | null;
          phys_cash_cogs?: number | null;
          phys_cash_profit?: number | null;
          phys_cash_margin?: number | null;
          phys_cash_orders?: number | null;
          phys_cash_qty?: number | null;
          phys_cash_aov?: number | null;
          phys_non_cash_revenue?: number | null;
          phys_non_cash_net_sales?: number | null;
          phys_non_cash_shipping?: number | null;
          phys_non_cash_cogs?: number | null;
          phys_non_cash_profit?: number | null;
          phys_non_cash_margin?: number | null;
          phys_non_cash_orders?: number | null;
          phys_non_cash_qty?: number | null;
          phys_non_cash_aov?: number | null;
          mem_revenue?: number | null;
          mem_net_sales?: number | null;
          mem_shipping?: number | null;
          mem_cogs?: number | null;
          mem_profit?: number | null;
          mem_margin?: number | null;
          mem_orders?: number | null;
          mem_qty?: number | null;
          mem_aov?: number | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          date?: string;
          total_revenue?: number | null;
          total_net_sales?: number | null;
          total_shipping?: number | null;
          total_cogs?: number | null;
          total_profit?: number | null;
          total_margin?: number | null;
          total_orders?: number | null;
          total_qty?: number | null;
          total_aov?: number | null;
          phys_cash_revenue?: number | null;
          phys_cash_net_sales?: number | null;
          phys_cash_shipping?: number | null;
          phys_cash_cogs?: number | null;
          phys_cash_profit?: number | null;
          phys_cash_margin?: number | null;
          phys_cash_orders?: number | null;
          phys_cash_qty?: number | null;
          phys_cash_aov?: number | null;
          phys_non_cash_revenue?: number | null;
          phys_non_cash_net_sales?: number | null;
          phys_non_cash_shipping?: number | null;
          phys_non_cash_cogs?: number | null;
          phys_non_cash_profit?: number | null;
          phys_non_cash_margin?: number | null;
          phys_non_cash_orders?: number | null;
          phys_non_cash_qty?: number | null;
          phys_non_cash_aov?: number | null;
          mem_revenue?: number | null;
          mem_net_sales?: number | null;
          mem_shipping?: number | null;
          mem_cogs?: number | null;
          mem_profit?: number | null;
          mem_margin?: number | null;
          mem_orders?: number | null;
          mem_qty?: number | null;
          mem_aov?: number | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      daily_products: {
        Row: {
          id: number;
          date: string;
          title: string;
          variant: string;
          item_type: string;
          net_sales: number;
          shipping: number;
          cogs: number;
          revenue: number;
          qty: number;
          orders: number;
          created_at: string;
        };
        Insert: {
          id?: number | null;
          date: string;
          title: string;
          variant?: string | null;
          item_type: string;
          net_sales?: number | null;
          shipping?: number | null;
          cogs?: number | null;
          revenue?: number | null;
          qty?: number | null;
          orders?: number | null;
          created_at?: string | null;
        };
        Update: {
          id?: number | null;
          date?: string;
          title?: string;
          variant?: string | null;
          item_type?: string;
          net_sales?: number | null;
          shipping?: number | null;
          cogs?: number | null;
          revenue?: number | null;
          qty?: number | null;
          orders?: number | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      daily_membership_orders: {
        Row: {
          id: number;
          date: string;
          order_name: string;
          membership_type: string;
          net_sales: number;
          shipping: number;
          revenue: number;
          created_at: string;
        };
        Insert: {
          id?: number | null;
          date: string;
          order_name: string;
          membership_type: string;
          net_sales?: number | null;
          shipping?: number | null;
          revenue?: number | null;
          created_at?: string | null;
        };
        Update: {
          id?: number | null;
          date?: string;
          order_name?: string;
          membership_type?: string;
          net_sales?: number | null;
          shipping?: number | null;
          revenue?: number | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      daily_customer_segments: {
        Row: {
          id: number;
          date: string;
          payment_type: string;
          customer_type: string;
          revenue: number;
          net_sales: number;
          shipping: number;
          cogs: number;
          profit: number;
          margin: number;
          orders: number;
          qty: number;
          aov: number;
          created_at: string;
        };
        Insert: {
          id?: number | null;
          date: string;
          payment_type: string;
          customer_type: string;
          revenue?: number | null;
          net_sales?: number | null;
          shipping?: number | null;
          cogs?: number | null;
          profit?: number | null;
          margin?: number | null;
          orders?: number | null;
          qty?: number | null;
          aov?: number | null;
          created_at?: string | null;
        };
        Update: {
          id?: number | null;
          date?: string;
          payment_type?: string;
          customer_type?: string;
          revenue?: number | null;
          net_sales?: number | null;
          shipping?: number | null;
          cogs?: number | null;
          profit?: number | null;
          margin?: number | null;
          orders?: number | null;
          qty?: number | null;
          aov?: number | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      raw_data: {
        Row: {
          id: number;
          date: string;
          fetched_at: string;
          order_rows: Json;
          payment_rows: Json;
        };
        Insert: {
          id?: number | null;
          date: string;
          fetched_at?: string | null;
          order_rows: Json;
          payment_rows: Json;
        };
        Update: {
          id?: number | null;
          date?: string;
          fetched_at?: string | null;
          order_rows?: Json;
          payment_rows?: Json;
        };
        Relationships: [];
      };
      job_logs: {
        Row: {
          id: number;
          date: string | null;
          job_type: string;
          status: string;
          message: string | null;
          meta: Json | null;
          created_at: string;
        };
        Insert: {
          id?: number | null;
          date?: string | null;
          job_type?: string | null;
          status: string;
          message?: string | null;
          meta?: Json | null;
          created_at?: string | null;
        };
        Update: {
          id?: number | null;
          date?: string | null;
          job_type?: string | null;
          status?: string;
          message?: string | null;
          meta?: Json | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      stripe_daily_snapshot: {
        Row: {
          date: string;
          payload: Json;
          fetched_at: string;
        };
        Insert: {
          date: string;
          payload: Json;
          fetched_at?: string;
        };
        Update: {
          date?: string;
          payload?: Json;
          fetched_at?: string;
        };
        Relationships: [];
      };
      analytics_event_categories: {
        Row: { id: number; name: string; color: string | null; icon: string | null; created_at: string };
        Insert: { id?: number; name: string; color?: string | null; icon?: string | null; created_at?: string };
        Update: { id?: number; name?: string; color?: string | null; icon?: string | null; created_at?: string };
        Relationships: [];
      };
      analytics_event_definitions: {
        Row: { id: number; event_type: string; display_name: string; description: string | null; category_id: number | null; is_conversion: boolean; is_purchase: boolean; revenue_property: string | null; created_at: string; updated_at: string };
        Insert: { id?: number; event_type: string; display_name: string; description?: string | null; category_id?: number | null; is_conversion?: boolean; is_purchase?: boolean; revenue_property?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: number; event_type?: string; display_name?: string; description?: string | null; category_id?: number | null; is_conversion?: boolean; is_purchase?: boolean; revenue_property?: string | null; updated_at?: string };
        Relationships: [];
      };
      analytics_event_aliases: {
        Row: { id: number; alias: string; definition_id: number; created_at: string };
        Insert: { id?: number; alias: string; definition_id: number; created_at?: string };
        Update: { id?: number; alias?: string; definition_id?: number };
        Relationships: [];
      };
      analytics_path_definitions: {
        Row: { id: number; path_pattern: string; canonical_name: string; description: string | null; created_at: string; updated_at: string };
        Insert: { id?: number; path_pattern: string; canonical_name: string; description?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: number; path_pattern?: string; canonical_name?: string; description?: string | null; updated_at?: string };
        Relationships: [];
      };
      analytics_path_observations: {
        Row: { id: number; raw_path: string; definition_id: number | null; first_seen_at: string; last_seen_at: string; hit_count: number };
        Insert: { id?: number; raw_path: string; definition_id?: number | null; first_seen_at?: string; last_seen_at?: string; hit_count?: number };
        Update: { id?: number; raw_path?: string; definition_id?: number | null; last_seen_at?: string; hit_count?: number };
        Relationships: [];
      };
      analytics_property_definitions: {
        Row: { id: number; property_key: string; display_name: string; description: string | null; data_type: string; created_at: string; updated_at: string };
        Insert: { id?: number; property_key: string; display_name: string; description?: string | null; data_type?: string; created_at?: string; updated_at?: string };
        Update: { id?: number; property_key?: string; display_name?: string; description?: string | null; data_type?: string; updated_at?: string };
        Relationships: [];
      };
      analytics_property_aliases: {
        Row: { id: number; alias_key: string; definition_id: number; created_at: string };
        Insert: { id?: number; alias_key: string; definition_id: number; created_at?: string };
        Update: { id?: number; alias_key?: string; definition_id?: number };
        Relationships: [];
      };
      analytics_funnels: {
        Row: { id: number; name: string; description: string | null; steps: Json; created_at: string; updated_at: string };
        Insert: { id?: number; name: string; description?: string | null; steps?: Json; created_at?: string; updated_at?: string };
        Update: { id?: number; name?: string; description?: string | null; steps?: Json; updated_at?: string };
        Relationships: [];
      };
      analytics_behaviors: {
        Row: { id: number; name: string; description: string | null; predicates: Json; created_at: string; updated_at: string };
        Insert: { id?: number; name: string; description?: string | null; predicates?: Json; created_at?: string; updated_at?: string };
        Update: { id?: number; name?: string; description?: string | null; predicates?: Json; updated_at?: string };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
