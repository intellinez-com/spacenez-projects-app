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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      comments: {
        Row: {
          body: string
          created_at: string
          id: string
          project_id: string
          task_id: string | null
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          project_id: string
          task_id?: string | null
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          project_id?: string
          task_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_task_project_fkey"
            columns: ["task_id", "project_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          created_at: string
          id: string
          name: string
          path: string
          project_id: string
          size: number | null
          task_id: string | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          path: string
          project_id: string
          size?: number | null
          task_id?: string | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          path?: string
          project_id?: string
          size?: number | null
          task_id?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_task_project_fkey"
            columns: ["task_id", "project_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_activity: {
        Row: {
          actor_id: string | null
          id: string
          kind: string
          occurred_at: string
          payload: Json
          project_id: string
          source_id: string
          source_type: string
          task_id: string | null
        }
        Insert: {
          actor_id?: string | null
          id?: string
          kind: string
          occurred_at?: string
          payload?: Json
          project_id: string
          source_id: string
          source_type: string
          task_id?: string | null
        }
        Update: {
          actor_id?: string | null
          id?: string
          kind?: string
          occurred_at?: string
          payload?: Json
          project_id?: string
          source_id?: string
          source_type?: string
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_activity_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_activity_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_activity_tracking: {
        Row: { id: boolean; started_at: string }
        Insert: { id?: boolean; started_at?: string }
        Update: { id?: boolean; started_at?: string }
        Relationships: []
      }
      project_daily_updates: {
        Row: {
          blockers: string
          created_at: string
          created_by: string
          id: string
          next_steps: string
          project_id: string
          report_date: string
          work_done: string
        }
        Insert: {
          blockers?: string
          created_at?: string
          created_by?: string
          id?: string
          next_steps?: string
          project_id: string
          report_date?: string
          work_done: string
        }
        Update: {
          blockers?: string
          created_at?: string
          created_by?: string
          id?: string
          next_steps?: string
          project_id?: string
          report_date?: string
          work_done?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_daily_updates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_daily_updates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          company: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          company?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      project_members: {
        Row: {
          access: string
          created_at: string
          id: string
          project_id: string
          user_id: string
        }
        Insert: {
          access?: string
          created_at?: string
          id?: string
          project_id: string
          user_id: string
        }
        Update: {
          access?: string
          created_at?: string
          id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_stages: {
        Row: { project_id: string; key: string; label: string; position: number; archived_at: string | null }
        Insert: { project_id: string; key: string; label: string; position?: number; archived_at?: string | null }
        Update: { key?: string; label?: string; position?: number; archived_at?: string | null }
        Relationships: [{ foreignKeyName: "project_stages_project_id_fkey"; columns: ["project_id"]; isOneToOne: false; referencedRelation: "projects"; referencedColumns: ["id"] }]
      }
      projects: {
        Row: {
          client_brand: string | null
          client_email: string | null
          client_name: string | null
          created_at: string
          created_by: string | null
          current_stage: string
          description: string | null
          id: string
          location: string | null
          meeting_url: string | null
          name: string
          project_type: string
          stage_revision: number
          start_date: string | null
          status: string
          target_date: string | null
        }
        Insert: {
          client_brand?: string | null
          client_email?: string | null
          client_name?: string | null
          created_at?: string
          created_by?: string | null
          current_stage?: string
          description?: string | null
          id?: string
          location?: string | null
          meeting_url?: string | null
          name: string
          project_type?: string
          stage_revision?: number
          start_date?: string | null
          status?: string
          target_date?: string | null
        }
        Update: {
          client_brand?: string | null
          client_email?: string | null
          client_name?: string | null
          created_at?: string
          created_by?: string | null
          current_stage?: string
          description?: string | null
          id?: string
          location?: string | null
          meeting_url?: string | null
          name?: string
          project_type?: string
          stage_revision?: number
          start_date?: string | null
          status?: string
          target_date?: string | null
        }
        Relationships: []
      }
      tasks: {
        Row: {
          assignee_id: string | null
          content_revision: number
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          position: number
          priority: string
          project_id: string
          source_id: string | null
          source_metadata: Json
          stage: string
          start_date: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          content_revision?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          position?: number
          priority?: string
          project_id: string
          source_id?: string | null
          source_metadata?: Json
          stage?: string
          start_date?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          content_revision?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          position?: number
          priority?: string
          project_id?: string
          source_id?: string | null
          source_metadata?: Json
          stage?: string
          start_date?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      task_approvals: {
        Row: {
          id: string
          project_id: string
          task_id: string
          revision: number
          state: "pending" | "approved" | "changes_requested"
          snapshot: Json
          requested_by: string
          requested_at: string
          decided_by: string | null
          decided_at: string | null
          feedback: string | null
        }
        Insert: {
          id?: string
          project_id: string
          task_id: string
          revision: number
          state?: "pending" | "approved" | "changes_requested"
          snapshot: Json
          requested_by: string
          requested_at?: string
          decided_by?: string | null
          decided_at?: string | null
          feedback?: string | null
        }
        Update: {
          id?: string
          project_id?: string
          task_id?: string
          revision?: number
          state?: "pending" | "approved" | "changes_requested"
          snapshot?: Json
          requested_by?: string
          requested_at?: string
          decided_by?: string | null
          decided_at?: string | null
          feedback?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_approvals_task_project_fkey"
            columns: ["task_id", "project_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "task_approvals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_approvals_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_approvals_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_approval_plan: {
        Row: {
          id: string
          project_id: string
          task_id: string
          source_id: string
          stage_gate: string | null
          milestone: string | null
          description: string | null
          source_metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          task_id: string
          source_id: string
          stage_gate?: string | null
          milestone?: string | null
          description?: string | null
          source_metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          task_id?: string
          source_id?: string
          stage_gate?: string | null
          milestone?: string | null
          description?: string | null
          source_metadata?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_approval_plan_task_project_fkey"
            columns: ["task_id", "project_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "task_approval_plan_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_imports: {
        Row: {
          id: string
          project_id: string
          import_key: string
          source_sha256: string
          imported_by: string
          imported_at: string
          task_count: number
          approval_plan_count: number
          client_linked: boolean
        }
        Insert: {
          id?: string
          project_id: string
          import_key: string
          source_sha256: string
          imported_by: string
          imported_at?: string
          task_count: number
          approval_plan_count: number
          client_linked?: boolean
        }
        Update: {
          id?: string
          project_id?: string
          import_key?: string
          source_sha256?: string
          imported_by?: string
          imported_at?: string
          task_count?: number
          approval_plan_count?: number
          client_linked?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "project_imports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_imports_imported_by_fkey"
            columns: ["imported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      mutate_project_stages: {
        Args: { p_project_id: string; p_expected_version: number; p_request_id: string; p_action: Json }
        Returns: Json
      }
      duplicate_project: {
        Args: { p_source_project_id: string; p_request_id: string; p_project: Json }
        Returns: Json
      }
      get_project_task_people: {
        Args: { p_project_id: string }
        Returns: { id: string; full_name: string; email: string | null }[]
      }
      get_project_finance: {
        Args: { p_project_id: string }
        Returns: Json
      }
      save_project_finance: {
        Args: { p_project_id: string; p_expected_version: number; p_plan: Json; p_milestones: Json }
        Returns: Json
      }
      record_project_payment: {
        Args: { p_project_id: string; p_payment: Json; p_allocations?: Json }
        Returns: Json
      }
      review_project_payment: {
        Args: { p_payment_id: string; p_decision: string; p_reason: string; p_allocations?: Json }
        Returns: Json
      }
      allocate_project_payment: {
        Args: { p_payment_id: string; p_allocations: Json }
        Returns: Json
      }
      approval_retains_file: {
        Args: { p_document_id: string | null; p_path: string | null }
        Returns: boolean
      }
      import_project_plan: {
        Args: { p_project: Json; p_tasks: Json; p_approval_plan: Json; p_source_sha256: string }
        Returns: Json
      }
      request_task_approval: {
        Args: { p_task_id: string }
        Returns: Database["public"]["Tables"]["task_approvals"]["Row"]
      }
      respond_task_approval: {
        Args: { p_approval_id: string; p_decision: string; p_feedback?: string | null }
        Returns: Database["public"]["Tables"]["task_approvals"]["Row"]
      }
      can_edit_project: {
        Args: { _project: string; _user: string }
        Returns: boolean
      }
      can_view_project: {
        Args: { _project: string; _user: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_project_member: {
        Args: { _project: string; _user: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "partner" | "client"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["admin", "partner", "client"],
    },
  },
} as const
