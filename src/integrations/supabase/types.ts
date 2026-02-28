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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      api_audit_log: {
        Row: {
          api_key_id: string | null
          created_at: string
          duration_ms: number | null
          id: string
          ip: string | null
          method: string
          path: string
          seller_id: string | null
          status_code: number | null
        }
        Insert: {
          api_key_id?: string | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          ip?: string | null
          method: string
          path: string
          seller_id?: string | null
          status_code?: number | null
        }
        Update: {
          api_key_id?: string | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          ip?: string | null
          method?: string
          path?: string
          seller_id?: string | null
          status_code?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "api_audit_log_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_audit_log_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          key_hash: string
          last_used_at: string | null
          name: string
          seller_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          key_hash: string
          last_used_at?: string | null
          name: string
          seller_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          key_hash?: string
          last_used_at?: string | null
          name?: string
          seller_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      api_rate_limits: {
        Row: {
          api_key_id: string
          id: string
          request_count: number
          window_start: string
        }
        Insert: {
          api_key_id: string
          id?: string
          request_count?: number
          window_start: string
        }
        Update: {
          api_key_id?: string
          id?: string
          request_count?: number
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_rate_limits_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      api_token_cache: {
        Row: {
          access_token: string
          expires_at: string
          id: string
          updated_at: string | null
        }
        Insert: {
          access_token: string
          expires_at: string
          id: string
          updated_at?: string | null
        }
        Update: {
          access_token?: string
          expires_at?: string
          id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      ebay_inventory_items: {
        Row: {
          created_at: string
          id: string
          last_pushed_at: string | null
          payload_hash: string | null
          seller_id: string
          sku: string
          source_product_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_pushed_at?: string | null
          payload_hash?: string | null
          seller_id: string
          sku: string
          source_product_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_pushed_at?: string | null
          payload_hash?: string | null
          seller_id?: string
          sku?: string
          source_product_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ebay_inventory_items_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ebay_inventory_items_source_product_id_fkey"
            columns: ["source_product_id"]
            isOneToOne: false
            referencedRelation: "source_products"
            referencedColumns: ["id"]
          },
        ]
      }
      ebay_offers: {
        Row: {
          category_id: string | null
          created_at: string
          fulfillment_policy_id: string | null
          id: string
          last_synced_at: string | null
          listing_id: string | null
          offer_id: string | null
          payment_policy_id: string | null
          price: number | null
          quantity: number | null
          return_policy_id: string | null
          seller_id: string
          sku: string
          source_url: string | null
          state: string
          title: string | null
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          fulfillment_policy_id?: string | null
          id?: string
          last_synced_at?: string | null
          listing_id?: string | null
          offer_id?: string | null
          payment_policy_id?: string | null
          price?: number | null
          quantity?: number | null
          return_policy_id?: string | null
          seller_id: string
          sku: string
          source_url?: string | null
          state?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          fulfillment_policy_id?: string | null
          id?: string
          last_synced_at?: string | null
          listing_id?: string | null
          offer_id?: string | null
          payment_policy_id?: string | null
          price?: number | null
          quantity?: number | null
          return_policy_id?: string | null
          seller_id?: string
          sku?: string
          source_url?: string | null
          state?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ebay_offers_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          attempts: number
          created_at: string
          error: string | null
          id: string
          input: Json | null
          max_attempts: number
          output: Json | null
          run_after: string
          seller_id: string
          state: string
          type: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error?: string | null
          id?: string
          input?: Json | null
          max_attempts?: number
          output?: Json | null
          run_after?: string
          seller_id: string
          state?: string
          type: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error?: string | null
          id?: string
          input?: Json | null
          max_attempts?: number
          output?: Json | null
          run_after?: string
          seller_id?: string
          state?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          line_item_id: string | null
          order_id: string
          price: number | null
          quantity: number
          seller_id: string
          sku: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          line_item_id?: string | null
          order_id: string
          price?: number | null
          quantity?: number
          seller_id: string
          sku?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          line_item_id?: string | null
          order_id?: string
          price?: number | null
          quantity?: number
          seller_id?: string
          sku?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          buyer_json: Json | null
          created_at: string
          currency: string
          id: string
          last_synced_at: string | null
          needs_fulfillment: boolean
          order_id: string
          order_status: string
          seller_id: string
          total_price: number | null
          updated_at: string
        }
        Insert: {
          buyer_json?: Json | null
          created_at?: string
          currency?: string
          id?: string
          last_synced_at?: string | null
          needs_fulfillment?: boolean
          order_id: string
          order_status?: string
          seller_id: string
          total_price?: number | null
          updated_at?: string
        }
        Update: {
          buyer_json?: Json | null
          created_at?: string
          currency?: string
          id?: string
          last_synced_at?: string | null
          needs_fulfillment?: boolean
          order_id?: string
          order_status?: string
          seller_id?: string
          total_price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      sellers: {
        Row: {
          amazon_email: string | null
          amazon_password_enc: string | null
          created_at: string
          ebay_user_id: string | null
          id: string
          is_active: boolean
          marketplace: string
          pricing_settings: Json
          refresh_token_enc: string | null
          token_scopes: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amazon_email?: string | null
          amazon_password_enc?: string | null
          created_at?: string
          ebay_user_id?: string | null
          id?: string
          is_active?: boolean
          marketplace?: string
          pricing_settings?: Json
          refresh_token_enc?: string | null
          token_scopes?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amazon_email?: string | null
          amazon_password_enc?: string | null
          created_at?: string
          ebay_user_id?: string | null
          id?: string
          is_active?: boolean
          marketplace?: string
          pricing_settings?: Json
          refresh_token_enc?: string | null
          token_scopes?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      shipments: {
        Row: {
          carrier: string
          created_at: string
          id: string
          order_id: string
          payload_json: Json | null
          seller_id: string
          shipped_at: string | null
          tracking_number: string
          tracking_pushed: boolean
        }
        Insert: {
          carrier: string
          created_at?: string
          id?: string
          order_id: string
          payload_json?: Json | null
          seller_id: string
          shipped_at?: string | null
          tracking_number: string
          tracking_pushed?: boolean
        }
        Update: {
          carrier?: string
          created_at?: string
          id?: string
          order_id?: string
          payload_json?: Json | null
          seller_id?: string
          shipped_at?: string | null
          tracking_number?: string
          tracking_pushed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "shipments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      sku_map: {
        Row: {
          active: boolean
          cj_variant_id: string
          created_at: string
          default_qty: number
          ebay_sku: string
          id: string
          min_margin_pct: number
          seller_id: string
          supplier: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          cj_variant_id: string
          created_at?: string
          default_qty?: number
          ebay_sku: string
          id?: string
          min_margin_pct?: number
          seller_id: string
          supplier?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          cj_variant_id?: string
          created_at?: string
          default_qty?: number
          ebay_sku?: string
          id?: string
          min_margin_pct?: number
          seller_id?: string
          supplier?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sku_map_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      source_products: {
        Row: {
          attributes_json: Json | null
          created_at: string
          description: string | null
          id: string
          images_json: Json | null
          last_synced_at: string | null
          price_ebay: number | null
          price_source: number | null
          price_synced_at: string | null
          seller_id: string
          source_id: string
          source_type: string
          stock_source: number | null
          title: string
          updated_at: string
          variants_json: Json | null
        }
        Insert: {
          attributes_json?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          images_json?: Json | null
          last_synced_at?: string | null
          price_ebay?: number | null
          price_source?: number | null
          price_synced_at?: string | null
          seller_id: string
          source_id: string
          source_type?: string
          stock_source?: number | null
          title: string
          updated_at?: string
          variants_json?: Json | null
        }
        Update: {
          attributes_json?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          images_json?: Json | null
          last_synced_at?: string | null
          price_ebay?: number | null
          price_source?: number | null
          price_synced_at?: string | null
          seller_id?: string
          source_id?: string
          source_type?: string
          stock_source?: number | null
          title?: string
          updated_at?: string
          variants_json?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "source_products_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_seller_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "seller"
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
    Enums: {
      app_role: ["admin", "seller"],
    },
  },
} as const
