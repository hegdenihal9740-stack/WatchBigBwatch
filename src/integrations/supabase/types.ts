export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      upi_payment_requests: {
        Row: {
          address: Json;
          confirmed_at: string | null;
          created_at: string;
          expires_at: string;
          id: string;
          items: Json;
          payment_reference: string | null;
          status: string;
          total: number;
          user_id: string;
        };
        Insert: {
          address: Json;
          confirmed_at?: string | null;
          created_at?: string;
          expires_at?: string;
          id: string;
          items: Json;
          payment_reference?: string | null;
          status?: string;
          total: number;
          user_id: string;
        };
        Update: {
          address?: Json;
          confirmed_at?: string | null;
          created_at?: string;
          expires_at?: string;
          id?: string;
          items?: Json;
          payment_reference?: string | null;
          status?: string;
          total?: number;
          user_id?: string;
        };
        Relationships: [];
      };
      customer_carts: {
        Row: {
          items: Json;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          items?: Json;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          items?: Json;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      customer_wishlists: {
        Row: {
          updated_at: string;
          user_id: string;
          watch_ids: string[];
        };
        Insert: {
          updated_at?: string;
          user_id: string;
          watch_ids?: string[];
        };
        Update: {
          updated_at?: string;
          user_id?: string;
          watch_ids?: string[];
        };
        Relationships: [];
      };
      inventory: {
        Row: {
          stock: number;
          updated_at: string;
          watch_id: string;
        };
        Insert: {
          stock?: number;
          updated_at?: string;
          watch_id: string;
        };
        Update: {
          stock?: number;
          updated_at?: string;
          watch_id?: string;
        };
        Relationships: [];
      };
      orders: {
        Row: {
          address: Json;
          awb: string | null;
          cod_confirmed: boolean;
          courier: string | null;
          created_at: string;
          id: string;
          items: Json;
          payment: string;
          payment_reference: string | null;
          seller_note: string | null;
          status: string;
          total: number;
          tracking_url: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          address?: Json;
          awb?: string | null;
          cod_confirmed?: boolean;
          courier?: string | null;
          created_at?: string;
          id: string;
          items?: Json;
          payment?: string;
          payment_reference?: string | null;
          seller_note?: string | null;
          status?: string;
          total?: number;
          tracking_url?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          address?: Json;
          awb?: string | null;
          cod_confirmed?: boolean;
          courier?: string | null;
          created_at?: string;
          id?: string;
          items?: Json;
          payment?: string;
          payment_reference?: string | null;
          seller_note?: string | null;
          status?: string;
          total?: number;
          tracking_url?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      razorpay_payment_orders: {
        Row: {
          address: Json;
          clear_cart: boolean;
          created_at: string;
          currency: string;
          id: string;
          idempotency_key: string;
          items: Json;
          payment_method: string;
          payment_id: string | null;
          razorpay_qr_code_id: string | null;
          razorpay_order_id: string | null;
          status: string;
          total: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          address: Json;
          clear_cart?: boolean;
          created_at?: string;
          currency?: string;
          id: string;
          idempotency_key: string;
          items: Json;
          payment_method?: string;
          payment_id?: string | null;
          razorpay_qr_code_id?: string | null;
          razorpay_order_id?: string | null;
          status?: string;
          total: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          address?: Json;
          clear_cart?: boolean;
          created_at?: string;
          currency?: string;
          id?: string;
          idempotency_key?: string;
          items?: Json;
          payment_method?: string;
          payment_id?: string | null;
          razorpay_qr_code_id?: string | null;
          razorpay_order_id?: string | null;
          status?: string;
          total?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      razorpay_webhook_events: {
        Row: {
          event_id: string;
          payment_order_id: string;
          received_at: string;
        };
        Insert: {
          event_id: string;
          payment_order_id: string;
          received_at?: string;
        };
        Update: {
          event_id?: string;
          payment_order_id?: string;
          received_at?: string;
        };
        Relationships: [];
      };
      products: {
        Row: {
          active: boolean;
          created_at: string;
          description: string;
          details: string[];
          finish: string;
          id: string;
          image_url: string;
          images: string[];
          list_price: number;
          name: string;
          price: number;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          description?: string;
          details?: string[];
          finish?: string;
          id: string;
          image_url?: string;
          images?: string[];
          list_price?: number;
          name: string;
          price?: number;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          description?: string;
          details?: string[];
          finish?: string;
          id?: string;
          image_url?: string;
          images?: string[];
          list_price?: number;
          name?: string;
          price?: number;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          address_line: string;
          address_type: string;
          birth_date: string | null;
          city: string;
          created_at: string;
          display_name: string;
          gender: string;
          id: string;
          landmark: string;
          locality: string;
          phone: string;
          pincode: string;
          state: string;
        };
        Insert: {
          address_line?: string;
          address_type?: string;
          birth_date?: string | null;
          city?: string;
          created_at?: string;
          display_name?: string;
          gender?: string;
          id: string;
          landmark?: string;
          locality?: string;
          phone?: string;
          pincode?: string;
          state?: string;
        };
        Update: {
          address_line?: string;
          address_type?: string;
          birth_date?: string | null;
          city?: string;
          created_at?: string;
          display_name?: string;
          gender?: string;
          id?: string;
          landmark?: string;
          locality?: string;
          phone?: string;
          pincode?: string;
          state?: string;
        };
        Relationships: [];
      };
      reviews: {
        Row: {
          author: string;
          comment: string;
          created_at: string;
          id: string;
          photos: string[];
          product_id: string;
          rating: number;
          user_id: string;
          verified: boolean;
        };
        Insert: {
          author: string;
          comment: string;
          created_at?: string;
          id?: string;
          photos?: string[];
          product_id: string;
          rating: number;
          user_id?: string;
          verified?: boolean;
        };
        Update: {
          author?: string;
          comment?: string;
          created_at?: string;
          id?: string;
          photos?: string[];
          product_id?: string;
          rating?: number;
          user_id?: string;
          verified?: boolean;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      cancel_order: { Args: { _order_id: string }; Returns: boolean };
      claim_store_owner: { Args: never; Returns: boolean };
      confirm_upi_payment: { Args: { _request_id: string }; Returns: Json };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      finalize_razorpay_payment: {
        Args: {
          _event_id?: string | null;
          _order_id: string;
          _payment_id?: string | null;
          _payment_status: string;
        };
        Returns: Json;
      };
      store_has_owner: { Args: never; Returns: boolean };
      transfer_store_owner: { Args: { _new_email: string }; Returns: string };
    };
    Enums: {
      app_role: "admin" | "user";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const;
