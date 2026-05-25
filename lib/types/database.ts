export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      analytics_behaviors: {
        Row: {
          created_at: string
          description: string | null
          id: number
          name: string
          predicates: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: number
          name: string
          predicates?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: number
          name?: string
          predicates?: Json
          updated_at?: string
        }
        Relationships: []
      }
      analytics_event_aliases: {
        Row: {
          alias: string
          created_at: string
          definition_id: number
          id: number
        }
        Insert: {
          alias: string
          created_at?: string
          definition_id: number
          id?: number
        }
        Update: {
          alias?: string
          created_at?: string
          definition_id?: number
          id?: number
        }
        Relationships: [
          {
            foreignKeyName: "analytics_event_aliases_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "analytics_event_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_event_categories: {
        Row: {
          color: string | null
          created_at: string
          icon: string | null
          id: number
          name: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: number
          name: string
        }
        Update: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: number
          name?: string
        }
        Relationships: []
      }
      analytics_event_definitions: {
        Row: {
          category_id: number | null
          created_at: string
          description: string | null
          display_name: string
          event_type: string
          id: number
          is_conversion: boolean
          is_purchase: boolean
          predicates: Json
          revenue_property: string | null
          updated_at: string
        }
        Insert: {
          category_id?: number | null
          created_at?: string
          description?: string | null
          display_name: string
          event_type: string
          id?: number
          is_conversion?: boolean
          is_purchase?: boolean
          predicates?: Json
          revenue_property?: string | null
          updated_at?: string
        }
        Update: {
          category_id?: number | null
          created_at?: string
          description?: string | null
          display_name?: string
          event_type?: string
          id?: number
          is_conversion?: boolean
          is_purchase?: boolean
          predicates?: Json
          revenue_property?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_event_definitions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "analytics_event_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_events_mirror: {
        Row: {
          click_id: string | null
          created_at: string
          device_type: string | null
          email: string | null
          event_category: string | null
          event_name: string
          id: string
          magic_id: string | null
          page_path: string | null
          page_url: string | null
          properties: Json | null
          referrer: string | null
          session_id: string | null
          synced_at: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          click_id?: string | null
          created_at: string
          device_type?: string | null
          email?: string | null
          event_category?: string | null
          event_name: string
          id: string
          magic_id?: string | null
          page_path?: string | null
          page_url?: string | null
          properties?: Json | null
          referrer?: string | null
          session_id?: string | null
          synced_at?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          click_id?: string | null
          created_at?: string
          device_type?: string | null
          email?: string | null
          event_category?: string | null
          event_name?: string
          id?: string
          magic_id?: string | null
          page_path?: string | null
          page_url?: string | null
          properties?: Json | null
          referrer?: string | null
          session_id?: string | null
          synced_at?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      analytics_funnels: {
        Row: {
          created_at: string
          description: string | null
          id: number
          name: string
          steps: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: number
          name: string
          steps?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: number
          name?: string
          steps?: Json
          updated_at?: string
        }
        Relationships: []
      }
      analytics_path_definitions: {
        Row: {
          canonical_name: string
          created_at: string
          description: string | null
          id: number
          path_pattern: string
          updated_at: string
        }
        Insert: {
          canonical_name: string
          created_at?: string
          description?: string | null
          id?: number
          path_pattern: string
          updated_at?: string
        }
        Update: {
          canonical_name?: string
          created_at?: string
          description?: string | null
          id?: number
          path_pattern?: string
          updated_at?: string
        }
        Relationships: []
      }
      analytics_path_observations: {
        Row: {
          definition_id: number | null
          first_seen_at: string
          hit_count: number
          id: number
          last_seen_at: string
          raw_path: string
        }
        Insert: {
          definition_id?: number | null
          first_seen_at?: string
          hit_count?: number
          id?: number
          last_seen_at?: string
          raw_path: string
        }
        Update: {
          definition_id?: number | null
          first_seen_at?: string
          hit_count?: number
          id?: number
          last_seen_at?: string
          raw_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_path_observations_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "analytics_path_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_property_aliases: {
        Row: {
          alias_key: string
          created_at: string
          definition_id: number
          id: number
        }
        Insert: {
          alias_key: string
          created_at?: string
          definition_id: number
          id?: number
        }
        Update: {
          alias_key?: string
          created_at?: string
          definition_id?: number
          id?: number
        }
        Relationships: [
          {
            foreignKeyName: "analytics_property_aliases_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "analytics_property_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_property_definitions: {
        Row: {
          created_at: string
          data_type: string
          description: string | null
          display_name: string
          id: number
          property_key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          data_type?: string
          description?: string | null
          display_name: string
          id?: number
          property_key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          data_type?: string
          description?: string | null
          display_name?: string
          id?: number
          property_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      analytics_sync_runs: {
        Row: {
          error: string | null
          finished_at: string | null
          http_status: number | null
          id: string
          kind: string
          pages_fetched: number
          rows_fetched: number
          rows_inserted: number
          started_at: string
          watermark_after_created_at: string | null
          watermark_before_created_at: string | null
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          http_status?: number | null
          id?: string
          kind: string
          pages_fetched?: number
          rows_fetched?: number
          rows_inserted?: number
          started_at?: string
          watermark_after_created_at?: string | null
          watermark_before_created_at?: string | null
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          http_status?: number | null
          id?: string
          kind?: string
          pages_fetched?: number
          rows_fetched?: number
          rows_inserted?: number
          started_at?: string
          watermark_after_created_at?: string | null
          watermark_before_created_at?: string | null
        }
        Relationships: []
      }
      analytics_sync_state: {
        Row: {
          backfill_complete: boolean
          backfill_oldest_synced_at: string | null
          backfill_target_at: string | null
          id: number
          last_run_at: string | null
          last_run_error: string | null
          last_run_rows: number | null
          last_run_status: string | null
          last_synced_created_at: string | null
          updated_at: string
        }
        Insert: {
          backfill_complete?: boolean
          backfill_oldest_synced_at?: string | null
          backfill_target_at?: string | null
          id?: number
          last_run_at?: string | null
          last_run_error?: string | null
          last_run_rows?: number | null
          last_run_status?: string | null
          last_synced_created_at?: string | null
          updated_at?: string
        }
        Update: {
          backfill_complete?: boolean
          backfill_oldest_synced_at?: string | null
          backfill_target_at?: string | null
          id?: number
          last_run_at?: string | null
          last_run_error?: string | null
          last_run_rows?: number | null
          last_run_status?: string | null
          last_synced_created_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      daily_customer_segments: {
        Row: {
          aov: number
          cogs: number
          created_at: string | null
          customer_type: string
          date: string
          id: number
          margin: number
          net_sales: number
          orders: number
          payment_type: string
          profit: number
          qty: number
          revenue: number
          shipping: number
        }
        Insert: {
          aov?: number
          cogs?: number
          created_at?: string | null
          customer_type: string
          date: string
          id?: number
          margin?: number
          net_sales?: number
          orders?: number
          payment_type: string
          profit?: number
          qty?: number
          revenue?: number
          shipping?: number
        }
        Update: {
          aov?: number
          cogs?: number
          created_at?: string | null
          customer_type?: string
          date?: string
          id?: number
          margin?: number
          net_sales?: number
          orders?: number
          payment_type?: string
          profit?: number
          qty?: number
          revenue?: number
          shipping?: number
        }
        Relationships: [
          {
            foreignKeyName: "daily_customer_segments_date_fkey"
            columns: ["date"]
            isOneToOne: false
            referencedRelation: "daily_summary"
            referencedColumns: ["date"]
          },
        ]
      }
      daily_membership_orders: {
        Row: {
          created_at: string
          date: string
          id: number
          membership_type: string
          net_sales: number
          order_name: string
          revenue: number
          shipping: number
        }
        Insert: {
          created_at?: string
          date: string
          id?: number
          membership_type: string
          net_sales?: number
          order_name: string
          revenue?: number
          shipping?: number
        }
        Update: {
          created_at?: string
          date?: string
          id?: number
          membership_type?: string
          net_sales?: number
          order_name?: string
          revenue?: number
          shipping?: number
        }
        Relationships: [
          {
            foreignKeyName: "daily_membership_orders_date_fkey"
            columns: ["date"]
            isOneToOne: false
            referencedRelation: "daily_summary"
            referencedColumns: ["date"]
          },
        ]
      }
      daily_products: {
        Row: {
          cogs: number
          created_at: string
          date: string
          id: number
          item_type: string
          net_sales: number
          orders: number
          qty: number
          revenue: number
          shipping: number
          title: string
          variant: string
        }
        Insert: {
          cogs?: number
          created_at?: string
          date: string
          id?: number
          item_type: string
          net_sales?: number
          orders?: number
          qty?: number
          revenue?: number
          shipping?: number
          title: string
          variant?: string
        }
        Update: {
          cogs?: number
          created_at?: string
          date?: string
          id?: number
          item_type?: string
          net_sales?: number
          orders?: number
          qty?: number
          revenue?: number
          shipping?: number
          title?: string
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_products_date_fkey"
            columns: ["date"]
            isOneToOne: false
            referencedRelation: "daily_summary"
            referencedColumns: ["date"]
          },
        ]
      }
      daily_summary: {
        Row: {
          created_at: string
          date: string
          mem_aov: number
          mem_cogs: number
          mem_margin: number
          mem_net_sales: number
          mem_orders: number
          mem_profit: number
          mem_qty: number
          mem_revenue: number
          mem_shipping: number
          phys_cash_aov: number
          phys_cash_cogs: number
          phys_cash_margin: number
          phys_cash_net_sales: number
          phys_cash_orders: number
          phys_cash_profit: number
          phys_cash_qty: number
          phys_cash_revenue: number
          phys_cash_shipping: number
          phys_non_cash_aov: number
          phys_non_cash_cogs: number
          phys_non_cash_margin: number
          phys_non_cash_net_sales: number
          phys_non_cash_orders: number
          phys_non_cash_profit: number
          phys_non_cash_qty: number
          phys_non_cash_revenue: number
          phys_non_cash_shipping: number
          total_aov: number
          total_cogs: number
          total_margin: number
          total_net_sales: number
          total_orders: number
          total_profit: number
          total_qty: number
          total_revenue: number
          total_shipping: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          mem_aov?: number
          mem_cogs?: number
          mem_margin?: number
          mem_net_sales?: number
          mem_orders?: number
          mem_profit?: number
          mem_qty?: number
          mem_revenue?: number
          mem_shipping?: number
          phys_cash_aov?: number
          phys_cash_cogs?: number
          phys_cash_margin?: number
          phys_cash_net_sales?: number
          phys_cash_orders?: number
          phys_cash_profit?: number
          phys_cash_qty?: number
          phys_cash_revenue?: number
          phys_cash_shipping?: number
          phys_non_cash_aov?: number
          phys_non_cash_cogs?: number
          phys_non_cash_margin?: number
          phys_non_cash_net_sales?: number
          phys_non_cash_orders?: number
          phys_non_cash_profit?: number
          phys_non_cash_qty?: number
          phys_non_cash_revenue?: number
          phys_non_cash_shipping?: number
          total_aov?: number
          total_cogs?: number
          total_margin?: number
          total_net_sales?: number
          total_orders?: number
          total_profit?: number
          total_qty?: number
          total_revenue?: number
          total_shipping?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          mem_aov?: number
          mem_cogs?: number
          mem_margin?: number
          mem_net_sales?: number
          mem_orders?: number
          mem_profit?: number
          mem_qty?: number
          mem_revenue?: number
          mem_shipping?: number
          phys_cash_aov?: number
          phys_cash_cogs?: number
          phys_cash_margin?: number
          phys_cash_net_sales?: number
          phys_cash_orders?: number
          phys_cash_profit?: number
          phys_cash_qty?: number
          phys_cash_revenue?: number
          phys_cash_shipping?: number
          phys_non_cash_aov?: number
          phys_non_cash_cogs?: number
          phys_non_cash_margin?: number
          phys_non_cash_net_sales?: number
          phys_non_cash_orders?: number
          phys_non_cash_profit?: number
          phys_non_cash_qty?: number
          phys_non_cash_revenue?: number
          phys_non_cash_shipping?: number
          total_aov?: number
          total_cogs?: number
          total_margin?: number
          total_net_sales?: number
          total_orders?: number
          total_profit?: number
          total_qty?: number
          total_revenue?: number
          total_shipping?: number
          updated_at?: string
        }
        Relationships: []
      }
      job_logs: {
        Row: {
          created_at: string
          date: string | null
          id: number
          job_type: string
          message: string | null
          meta: Json | null
          status: string
        }
        Insert: {
          created_at?: string
          date?: string | null
          id?: number
          job_type?: string
          message?: string | null
          meta?: Json | null
          status: string
        }
        Update: {
          created_at?: string
          date?: string | null
          id?: number
          job_type?: string
          message?: string | null
          meta?: Json | null
          status?: string
        }
        Relationships: []
      }
      paypal_daily_snapshot: {
        Row: {
          date: string
          fetched_at: string
          payload: Json
        }
        Insert: {
          date: string
          fetched_at?: string
          payload: Json
        }
        Update: {
          date?: string
          fetched_at?: string
          payload?: Json
        }
        Relationships: []
      }
      raw_data: {
        Row: {
          date: string
          fetched_at: string
          id: number
          order_rows: Json
          payment_rows: Json
        }
        Insert: {
          date: string
          fetched_at?: string
          id?: number
          order_rows?: Json
          payment_rows?: Json
        }
        Update: {
          date?: string
          fetched_at?: string
          id?: number
          order_rows?: Json
          payment_rows?: Json
        }
        Relationships: []
      }
      stripe_daily_snapshot: {
        Row: {
          date: string
          fetched_at: string
          payload: Json
        }
        Insert: {
          date: string
          fetched_at?: string
          payload: Json
        }
        Update: {
          date?: string
          fetched_at?: string
          payload?: Json
        }
        Relationships: []
      }
      mug_fulfillment_jobs: {
        Row: {
          id: string
          shopify_order_id: string
          shopify_order_name: string
          shopify_line_item_id: string
          tile_id: string | null
          print_file_url: string | null
          gelato_product_uid: string
          quantity: number
          state: string
          gelato_draft_id: string | null
          gelato_order_id: string | null
          tracking_number: string | null
          tracking_url: string | null
          tracking_company: string | null
          attempts: number
          last_error: string | null
          next_attempt_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          shopify_order_id: string
          shopify_order_name: string
          shopify_line_item_id: string
          tile_id?: string | null
          print_file_url?: string | null
          gelato_product_uid: string
          quantity?: number
          state?: string
          gelato_draft_id?: string | null
          gelato_order_id?: string | null
          tracking_number?: string | null
          tracking_url?: string | null
          tracking_company?: string | null
          attempts?: number
          last_error?: string | null
          next_attempt_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          shopify_order_id?: string
          shopify_order_name?: string
          shopify_line_item_id?: string
          tile_id?: string | null
          print_file_url?: string | null
          gelato_product_uid?: string
          quantity?: number
          state?: string
          gelato_draft_id?: string | null
          gelato_order_id?: string | null
          tracking_number?: string | null
          tracking_url?: string | null
          tracking_company?: string | null
          attempts?: number
          last_error?: string | null
          next_attempt_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      mug_fulfillment_events: {
        Row: {
          id: string
          job_id: string
          event_type: string
          from_state: string | null
          to_state: string | null
          payload: Json | null
          error: string | null
          created_at: string
        }
        Insert: {
          id?: string
          job_id: string
          event_type: string
          from_state?: string | null
          to_state?: string | null
          payload?: Json | null
          error?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          job_id?: string
          event_type?: string
          from_state?: string | null
          to_state?: string | null
          payload?: Json | null
          error?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mug_fulfillment_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mug_fulfillment_jobs"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      analytics_behavior: {
        Args: {
          p_conditions: Json
          p_from: string
          p_identifier?: string
          p_include_preview?: boolean
          p_to: string
        }
        Returns: {
          by_device: Json
          by_source: Json
          events_per_session: number
          matched_events: number
          matched_sessions: number
        }[]
      }
      analytics_funnel: {
        Args: {
          p_from: string
          p_identifier?: string
          p_include_preview?: boolean
          p_steps: Json
          p_to: string
          p_window_hours?: number
        }
        Returns: {
          conversion_from_prev: number
          conversion_from_start: number
          step_index: number
          step_label: string
          users: number
        }[]
      }
      analytics_predicate_matches: {
        Args: {
          e: Database["public"]["Tables"]["analytics_events_mirror"]["Row"]
          p: Json
        }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
