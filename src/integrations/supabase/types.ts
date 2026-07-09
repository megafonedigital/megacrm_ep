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
      agent_presence: {
        Row: {
          last_seen_at: string
          status: Database["public"]["Enums"]["presence_status"]
          user_id: string
        }
        Insert: {
          last_seen_at?: string
          status?: Database["public"]["Enums"]["presence_status"]
          user_id: string
        }
        Update: {
          last_seen_at?: string
          status?: Database["public"]["Enums"]["presence_status"]
          user_id?: string
        }
        Relationships: []
      }
      ai_agent_ab_tests: {
        Row: {
          agent_id: string
          brand_id: string
          created_at: string
          created_by: string | null
          description: string | null
          ends_at: string | null
          id: string
          name: string
          notes: string | null
          starts_at: string | null
          status: string
          traffic_b_percent: number
          updated_at: string
          version_a_id: string
          version_b_id: string
          winner: string | null
        }
        Insert: {
          agent_id: string
          brand_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          name: string
          notes?: string | null
          starts_at?: string | null
          status?: string
          traffic_b_percent?: number
          updated_at?: string
          version_a_id: string
          version_b_id: string
          winner?: string | null
        }
        Update: {
          agent_id?: string
          brand_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          name?: string
          notes?: string | null
          starts_at?: string | null
          status?: string
          traffic_b_percent?: number
          updated_at?: string
          version_a_id?: string
          version_b_id?: string
          winner?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_ab_tests_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agent_ab_tests_version_a_id_fkey"
            columns: ["version_a_id"]
            isOneToOne: false
            referencedRelation: "ai_agent_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agent_ab_tests_version_b_id_fkey"
            columns: ["version_b_id"]
            isOneToOne: false
            referencedRelation: "ai_agent_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agent_alerts: {
        Row: {
          agent_id: string
          brand_id: string
          created_at: string
          details: Json
          id: string
          kind: string
          resolved_at: string | null
          resolved_by: string | null
        }
        Insert: {
          agent_id: string
          brand_id: string
          created_at?: string
          details?: Json
          id?: string
          kind: string
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Update: {
          agent_id?: string
          brand_id?: string
          created_at?: string
          details?: Json
          id?: string
          kind?: string
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Relationships: []
      }
      ai_agent_channel_assignments: {
        Row: {
          agent_id: string
          channel_id: string
          created_at: string
          weight: number
        }
        Insert: {
          agent_id: string
          channel_id: string
          created_at?: string
          weight?: number
        }
        Update: {
          agent_id?: string
          channel_id?: string
          created_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_channel_assignments_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agent_contact_memory: {
        Row: {
          agent_id: string
          brand_id: string
          category: string
          confidence: number
          contact_id: string
          created_at: string
          id: string
          key: string
          last_mentioned_at: string
          source_message_id: string | null
          updated_at: string
          value: string
        }
        Insert: {
          agent_id: string
          brand_id: string
          category?: string
          confidence?: number
          contact_id: string
          created_at?: string
          id?: string
          key: string
          last_mentioned_at?: string
          source_message_id?: string | null
          updated_at?: string
          value: string
        }
        Update: {
          agent_id?: string
          brand_id?: string
          category?: string
          confidence?: number
          contact_id?: string
          created_at?: string
          id?: string
          key?: string
          last_mentioned_at?: string
          source_message_id?: string | null
          updated_at?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_contact_memory_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agent_contact_memory_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agent_contact_memory_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agent_delivery_jobs: {
        Row: {
          agent_id: string
          attempts: number
          brand_id: string
          channel_id: string | null
          content: string
          conversation_id: string
          created_at: string
          error_code: string | null
          error_message: string | null
          group_id: string
          id: string
          job_kind: string
          locked_at: string | null
          max_attempts: number
          message_id: string | null
          payload: Json
          run_after: string
          sent_at: string | null
          sequence: number
          status: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          attempts?: number
          brand_id: string
          channel_id?: string | null
          content?: string
          conversation_id: string
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          group_id?: string
          id?: string
          job_kind: string
          locked_at?: string | null
          max_attempts?: number
          message_id?: string | null
          payload?: Json
          run_after?: string
          sent_at?: string | null
          sequence?: number
          status?: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          attempts?: number
          brand_id?: string
          channel_id?: string | null
          content?: string
          conversation_id?: string
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          group_id?: string
          id?: string
          job_kind?: string
          locked_at?: string | null
          max_attempts?: number
          message_id?: string | null
          payload?: Json
          run_after?: string
          sent_at?: string | null
          sequence?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_delivery_jobs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agent_delivery_jobs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agent_delivery_jobs_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "brand_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agent_delivery_jobs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agent_delivery_jobs_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agent_function_runs: {
        Row: {
          agent_id: string | null
          arguments: Json
          brand_id: string
          created_at: string
          duration_ms: number | null
          error: string | null
          function_id: string | null
          id: string
          name: string
          result: Json | null
          run_id: string | null
          status: string
          thread_id: string | null
        }
        Insert: {
          agent_id?: string | null
          arguments?: Json
          brand_id: string
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          function_id?: string | null
          id?: string
          name: string
          result?: Json | null
          run_id?: string | null
          status?: string
          thread_id?: string | null
        }
        Update: {
          agent_id?: string | null
          arguments?: Json
          brand_id?: string
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          function_id?: string | null
          id?: string
          name?: string
          result?: Json | null
          run_id?: string | null
          status?: string
          thread_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_function_runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agent_function_runs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agent_function_runs_function_id_fkey"
            columns: ["function_id"]
            isOneToOne: false
            referencedRelation: "ai_agent_functions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agent_function_runs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ai_agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agent_functions: {
        Row: {
          action_type: string
          agent_id: string | null
          brand_id: string
          config: Json
          created_at: string
          created_by: string | null
          description: string
          enabled: boolean
          id: string
          name: string
          parameters_schema: Json
          save_results: boolean
          target_automation_id: string | null
          updated_at: string
        }
        Insert: {
          action_type?: string
          agent_id?: string | null
          brand_id: string
          config?: Json
          created_at?: string
          created_by?: string | null
          description?: string
          enabled?: boolean
          id?: string
          name: string
          parameters_schema?: Json
          save_results?: boolean
          target_automation_id?: string | null
          updated_at?: string
        }
        Update: {
          action_type?: string
          agent_id?: string | null
          brand_id?: string
          config?: Json
          created_at?: string
          created_by?: string | null
          description?: string
          enabled?: boolean
          id?: string
          name?: string
          parameters_schema?: Json
          save_results?: boolean
          target_automation_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_functions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agent_functions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agent_functions_target_automation_id_fkey"
            columns: ["target_automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agent_knowledge: {
        Row: {
          agent_id: string
          created_at: string
          kb_id: string
          kind: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          kb_id: string
          kind: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          kb_id?: string
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_knowledge_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agent_pending_runs: {
        Row: {
          agent_id: string
          conversation_id: string
          created_at: string
          run_after: string
        }
        Insert: {
          agent_id: string
          conversation_id: string
          created_at?: string
          run_after?: string
        }
        Update: {
          agent_id?: string
          conversation_id?: string
          created_at?: string
          run_after?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_pending_runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agent_runs: {
        Row: {
          ab_test_id: string | null
          ab_variant: string | null
          agent_id: string
          brand_id: string
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          escalation_track: string | null
          id: string
          input_messages: Json
          input_variables: Json | null
          latency_ms: number | null
          max_output_tokens: number | null
          model: string | null
          output_text: string | null
          status: Database["public"]["Enums"]["ai_agent_run_status"]
          temperature: number | null
          tokens_in: number | null
          tokens_out: number | null
          tool_call: Json | null
          triggered_by: Database["public"]["Enums"]["ai_agent_run_trigger"]
          version_id: string | null
        }
        Insert: {
          ab_test_id?: string | null
          ab_variant?: string | null
          agent_id: string
          brand_id: string
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          escalation_track?: string | null
          id?: string
          input_messages?: Json
          input_variables?: Json | null
          latency_ms?: number | null
          max_output_tokens?: number | null
          model?: string | null
          output_text?: string | null
          status: Database["public"]["Enums"]["ai_agent_run_status"]
          temperature?: number | null
          tokens_in?: number | null
          tokens_out?: number | null
          tool_call?: Json | null
          triggered_by?: Database["public"]["Enums"]["ai_agent_run_trigger"]
          version_id?: string | null
        }
        Update: {
          ab_test_id?: string | null
          ab_variant?: string | null
          agent_id?: string
          brand_id?: string
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          escalation_track?: string | null
          id?: string
          input_messages?: Json
          input_variables?: Json | null
          latency_ms?: number | null
          max_output_tokens?: number | null
          model?: string | null
          output_text?: string | null
          status?: Database["public"]["Enums"]["ai_agent_run_status"]
          temperature?: number | null
          tokens_in?: number | null
          tokens_out?: number | null
          tool_call?: Json | null
          triggered_by?: Database["public"]["Enums"]["ai_agent_run_trigger"]
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_runs_ab_test_id_fkey"
            columns: ["ab_test_id"]
            isOneToOne: false
            referencedRelation: "ai_agent_ab_tests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agent_runs_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "ai_agent_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agent_test_scenarios: {
        Row: {
          agent_id: string
          brand_id: string
          created_at: string
          description: string
          expect_must_contain: string[]
          expect_must_not_contain: string[]
          expect_need_human: boolean
          expect_need_human_reason: string | null
          faq_source_index: number | null
          faq_source_kb_id: string | null
          faq_source_kind: string | null
          id: string
          judge_criteria: string | null
          last_duration_ms: number | null
          last_failures: Json | null
          last_judge_verdict: Json | null
          last_model: string | null
          last_response: string | null
          last_run_at: string | null
          last_status: Database["public"]["Enums"]["ai_test_scenario_status"]
          last_tokens_in: number | null
          last_tokens_out: number | null
          last_tool_call: Json | null
          name: string
          source: Database["public"]["Enums"]["ai_test_scenario_source"]
          turns: Json
          updated_at: string
        }
        Insert: {
          agent_id: string
          brand_id: string
          created_at?: string
          description?: string
          expect_must_contain?: string[]
          expect_must_not_contain?: string[]
          expect_need_human?: boolean
          expect_need_human_reason?: string | null
          faq_source_index?: number | null
          faq_source_kb_id?: string | null
          faq_source_kind?: string | null
          id?: string
          judge_criteria?: string | null
          last_duration_ms?: number | null
          last_failures?: Json | null
          last_judge_verdict?: Json | null
          last_model?: string | null
          last_response?: string | null
          last_run_at?: string | null
          last_status?: Database["public"]["Enums"]["ai_test_scenario_status"]
          last_tokens_in?: number | null
          last_tokens_out?: number | null
          last_tool_call?: Json | null
          name: string
          source?: Database["public"]["Enums"]["ai_test_scenario_source"]
          turns?: Json
          updated_at?: string
        }
        Update: {
          agent_id?: string
          brand_id?: string
          created_at?: string
          description?: string
          expect_must_contain?: string[]
          expect_must_not_contain?: string[]
          expect_need_human?: boolean
          expect_need_human_reason?: string | null
          faq_source_index?: number | null
          faq_source_kb_id?: string | null
          faq_source_kind?: string | null
          id?: string
          judge_criteria?: string | null
          last_duration_ms?: number | null
          last_failures?: Json | null
          last_judge_verdict?: Json | null
          last_model?: string | null
          last_response?: string | null
          last_run_at?: string | null
          last_status?: Database["public"]["Enums"]["ai_test_scenario_status"]
          last_tokens_in?: number | null
          last_tokens_out?: number | null
          last_tool_call?: Json | null
          name?: string
          source?: Database["public"]["Enums"]["ai_test_scenario_source"]
          turns?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_test_scenarios_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agent_thread_messages: {
        Row: {
          agent_id: string
          brand_id: string
          content: string | null
          created_at: string
          id: string
          media_type: string | null
          media_url: string | null
          metadata: Json
          role: string
          thread_id: string
          tool_call_id: string | null
          tool_calls: Json | null
        }
        Insert: {
          agent_id: string
          brand_id: string
          content?: string | null
          created_at?: string
          id?: string
          media_type?: string | null
          media_url?: string | null
          metadata?: Json
          role: string
          thread_id: string
          tool_call_id?: string | null
          tool_calls?: Json | null
        }
        Update: {
          agent_id?: string
          brand_id?: string
          content?: string | null
          created_at?: string
          id?: string
          media_type?: string | null
          media_url?: string | null
          metadata?: Json
          role?: string
          thread_id?: string
          tool_call_id?: string | null
          tool_calls?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_thread_messages_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agent_thread_messages_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agent_thread_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "ai_agent_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agent_threads: {
        Row: {
          agent_id: string
          brand_id: string
          buyer_validated_at: string | null
          contact_email: string | null
          contact_id: string | null
          contact_phone: string | null
          created_at: string
          id: string
          is_buyer: boolean
          last_message_at: string | null
          metadata: Json
          updated_at: string
        }
        Insert: {
          agent_id: string
          brand_id: string
          buyer_validated_at?: string | null
          contact_email?: string | null
          contact_id?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_buyer?: boolean
          last_message_at?: string | null
          metadata?: Json
          updated_at?: string
        }
        Update: {
          agent_id?: string
          brand_id?: string
          buyer_validated_at?: string | null
          contact_email?: string | null
          contact_id?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_buyer?: boolean
          last_message_at?: string | null
          metadata?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_threads_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agent_threads_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agent_threads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agent_versions: {
        Row: {
          agent_id: string
          brand_id: string
          context_window_messages: number
          created_at: string
          created_by: string | null
          escalation_target_suporte: string | null
          escalation_target_vendas: string | null
          id: string
          inputs: Json
          label: string | null
          max_output_tokens: number
          model: string
          notes: string | null
          rate_limit_per_agent_hour: number | null
          rate_limit_per_conversation: number
          rate_limit_window_minutes: number
          response_delay_ms: number
          source: string
          system_prompt: string
          temperature: number
          version_number: number
        }
        Insert: {
          agent_id: string
          brand_id: string
          context_window_messages: number
          created_at?: string
          created_by?: string | null
          escalation_target_suporte?: string | null
          escalation_target_vendas?: string | null
          id?: string
          inputs?: Json
          label?: string | null
          max_output_tokens: number
          model: string
          notes?: string | null
          rate_limit_per_agent_hour?: number | null
          rate_limit_per_conversation?: number
          rate_limit_window_minutes?: number
          response_delay_ms: number
          source?: string
          system_prompt?: string
          temperature: number
          version_number: number
        }
        Update: {
          agent_id?: string
          brand_id?: string
          context_window_messages?: number
          created_at?: string
          created_by?: string | null
          escalation_target_suporte?: string | null
          escalation_target_vendas?: string | null
          id?: string
          inputs?: Json
          label?: string | null
          max_output_tokens?: number
          model?: string
          notes?: string | null
          rate_limit_per_agent_hour?: number | null
          rate_limit_per_conversation?: number
          rate_limit_window_minutes?: number
          response_delay_ms?: number
          source?: string
          system_prompt?: string
          temperature?: number
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_versions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agent_voice_configs: {
        Row: {
          agent_id: string
          brand_id: string
          created_at: string
          model_id: string
          provider: string
          send_mode: string
          similarity_boost: number
          speed: number
          stability: number
          style: number
          updated_at: string
          voice_id: string | null
        }
        Insert: {
          agent_id: string
          brand_id: string
          created_at?: string
          model_id?: string
          provider?: string
          send_mode?: string
          similarity_boost?: number
          speed?: number
          stability?: number
          style?: number
          updated_at?: string
          voice_id?: string | null
        }
        Update: {
          agent_id?: string
          brand_id?: string
          created_at?: string
          model_id?: string
          provider?: string
          send_mode?: string
          similarity_boost?: number
          speed?: number
          stability?: number
          style?: number
          updated_at?: string
          voice_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_voice_configs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agent_voice_configs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agents: {
        Row: {
          audio_mode: string
          brand_id: string
          buyer_validation_api_key_ref: string | null
          buyer_validation_api_url: string | null
          context_window_messages: number
          created_at: string
          created_by: string | null
          current_version_id: string | null
          default_user_message: string | null
          dynamic_quick_replies: boolean
          ellie_context_window: number | null
          escalation_alert_min_runs: number
          escalation_alert_threshold_pct: number | null
          escalation_alert_window_minutes: number
          escalation_target_suporte: string | null
          escalation_target_vendas: string | null
          followup_minutes: number | null
          group_inputs_seconds: number
          help_me_enabled: boolean
          help_me_slow_speed: number
          id: string
          image_mode: string
          inputs: Json
          lead_free_message_limit: number
          lead_mode_prompt: string | null
          lead_offer_prompt: string | null
          long_term_memory_enabled: boolean
          max_output_tokens: number
          model: string
          name: string
          process_inbound_images: boolean
          quick_replies: Json
          rate_limit_per_agent_hour: number | null
          rate_limit_per_conversation: number
          rate_limit_window_minutes: number
          response_delay_ms: number
          status: Database["public"]["Enums"]["ai_agent_status"]
          system_prompt: string
          temperature: number
          tracking_tag: string | null
          transcribe_inbound_audio: boolean
          updated_at: string
          whitelist: Json
        }
        Insert: {
          audio_mode?: string
          brand_id: string
          buyer_validation_api_key_ref?: string | null
          buyer_validation_api_url?: string | null
          context_window_messages?: number
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          default_user_message?: string | null
          dynamic_quick_replies?: boolean
          ellie_context_window?: number | null
          escalation_alert_min_runs?: number
          escalation_alert_threshold_pct?: number | null
          escalation_alert_window_minutes?: number
          escalation_target_suporte?: string | null
          escalation_target_vendas?: string | null
          followup_minutes?: number | null
          group_inputs_seconds?: number
          help_me_enabled?: boolean
          help_me_slow_speed?: number
          id?: string
          image_mode?: string
          inputs?: Json
          lead_free_message_limit?: number
          lead_mode_prompt?: string | null
          lead_offer_prompt?: string | null
          long_term_memory_enabled?: boolean
          max_output_tokens?: number
          model?: string
          name: string
          process_inbound_images?: boolean
          quick_replies?: Json
          rate_limit_per_agent_hour?: number | null
          rate_limit_per_conversation?: number
          rate_limit_window_minutes?: number
          response_delay_ms?: number
          status?: Database["public"]["Enums"]["ai_agent_status"]
          system_prompt?: string
          temperature?: number
          tracking_tag?: string | null
          transcribe_inbound_audio?: boolean
          updated_at?: string
          whitelist?: Json
        }
        Update: {
          audio_mode?: string
          brand_id?: string
          buyer_validation_api_key_ref?: string | null
          buyer_validation_api_url?: string | null
          context_window_messages?: number
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          default_user_message?: string | null
          dynamic_quick_replies?: boolean
          ellie_context_window?: number | null
          escalation_alert_min_runs?: number
          escalation_alert_threshold_pct?: number | null
          escalation_alert_window_minutes?: number
          escalation_target_suporte?: string | null
          escalation_target_vendas?: string | null
          followup_minutes?: number | null
          group_inputs_seconds?: number
          help_me_enabled?: boolean
          help_me_slow_speed?: number
          id?: string
          image_mode?: string
          inputs?: Json
          lead_free_message_limit?: number
          lead_mode_prompt?: string | null
          lead_offer_prompt?: string | null
          long_term_memory_enabled?: boolean
          max_output_tokens?: number
          model?: string
          name?: string
          process_inbound_images?: boolean
          quick_replies?: Json
          rate_limit_per_agent_hour?: number | null
          rate_limit_per_conversation?: number
          rate_limit_window_minutes?: number
          response_delay_ms?: number
          status?: Database["public"]["Enums"]["ai_agent_status"]
          system_prompt?: string
          temperature?: number
          tracking_tag?: string | null
          transcribe_inbound_audio?: boolean
          updated_at?: string
          whitelist?: Json
        }
        Relationships: []
      }
      ai_escalation_reviews: {
        Row: {
          agent_id: string
          brand_id: string
          conversation_id: string
          id: string
          original_reason: string | null
          reviewed_at: string
          reviewer_id: string | null
          run_id: string
          validated_reason: string | null
          was_correct: boolean
        }
        Insert: {
          agent_id: string
          brand_id: string
          conversation_id: string
          id?: string
          original_reason?: string | null
          reviewed_at?: string
          reviewer_id?: string | null
          run_id: string
          validated_reason?: string | null
          was_correct: boolean
        }
        Update: {
          agent_id?: string
          brand_id?: string
          conversation_id?: string
          id?: string
          original_reason?: string | null
          reviewed_at?: string
          reviewer_id?: string | null
          run_id?: string
          validated_reason?: string | null
          was_correct?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "ai_escalation_reviews_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ai_agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_knowledge_company: {
        Row: {
          brand_id: string
          company_name: string | null
          content: string
          created_at: string
          expert_name: string | null
          faq: Json
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          company_name?: string | null
          content?: string
          created_at?: string
          expert_name?: string | null
          faq?: Json
          id?: string
          name?: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          company_name?: string | null
          content?: string
          created_at?: string
          expert_name?: string | null
          faq?: Json
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_knowledge_context: {
        Row: {
          brand_id: string
          content: string
          created_at: string
          ends_at: string
          id: string
          starts_at: string
          title: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          content?: string
          created_at?: string
          ends_at: string
          id?: string
          starts_at: string
          title: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          content?: string
          created_at?: string
          ends_at?: string
          id?: string
          starts_at?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_knowledge_products: {
        Row: {
          brand_id: string
          created_at: string
          description: string
          external_product_id: string | null
          faq: Json
          id: string
          integration_product_id: string | null
          notes: string | null
          product_name: string
          source: Database["public"]["Enums"]["ai_knowledge_product_source"]
          summary: string
          updated_at: string
          utm_default: string | null
          utm_params: Json
        }
        Insert: {
          brand_id: string
          created_at?: string
          description?: string
          external_product_id?: string | null
          faq?: Json
          id?: string
          integration_product_id?: string | null
          notes?: string | null
          product_name: string
          source?: Database["public"]["Enums"]["ai_knowledge_product_source"]
          summary?: string
          updated_at?: string
          utm_default?: string | null
          utm_params?: Json
        }
        Update: {
          brand_id?: string
          created_at?: string
          description?: string
          external_product_id?: string | null
          faq?: Json
          id?: string
          integration_product_id?: string | null
          notes?: string | null
          product_name?: string
          source?: Database["public"]["Enums"]["ai_knowledge_product_source"]
          summary?: string
          updated_at?: string
          utm_default?: string | null
          utm_params?: Json
        }
        Relationships: []
      }
      ai_model_pricing: {
        Row: {
          input_per_1k: number
          model: string
          output_per_1k: number
          updated_at: string
        }
        Insert: {
          input_per_1k?: number
          model: string
          output_per_1k?: number
          updated_at?: string
        }
        Update: {
          input_per_1k?: number
          model?: string
          output_per_1k?: number
          updated_at?: string
        }
        Relationships: []
      }
      api_request_logs: {
        Row: {
          api_key_id: string | null
          api_key_prefix: string | null
          brand_id: string | null
          created_at: string
          duration_ms: number | null
          id: string
          ip: string | null
          method: string
          path: string
          request_body: Json | null
          response_summary: Json | null
          status_code: number
          user_agent: string | null
        }
        Insert: {
          api_key_id?: string | null
          api_key_prefix?: string | null
          brand_id?: string | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          ip?: string | null
          method: string
          path: string
          request_body?: Json | null
          response_summary?: Json | null
          status_code: number
          user_agent?: string | null
        }
        Update: {
          api_key_id?: string | null
          api_key_prefix?: string | null
          brand_id?: string | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          ip?: string | null
          method?: string
          path?: string
          request_body?: Json | null
          response_summary?: Json | null
          status_code?: number
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_request_logs_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "brand_api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_request_logs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      appointments: {
        Row: {
          assignee_id: string
          brand_id: string
          completed_at: string | null
          contact_id: string
          conversation_id: string | null
          created_at: string
          created_by: string
          id: string
          note: string | null
          notified_at: string | null
          pipeline_id: string | null
          pipeline_stage_id: string | null
          scheduled_at: string
          status: string
          updated_at: string
        }
        Insert: {
          assignee_id: string
          brand_id: string
          completed_at?: string | null
          contact_id: string
          conversation_id?: string | null
          created_at?: string
          created_by: string
          id?: string
          note?: string | null
          notified_at?: string | null
          pipeline_id?: string | null
          pipeline_stage_id?: string | null
          scheduled_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string
          brand_id?: string
          completed_at?: string | null
          contact_id?: string
          conversation_id?: string | null
          created_at?: string
          created_by?: string
          id?: string
          note?: string | null
          notified_at?: string | null
          pipeline_id?: string | null
          pipeline_stage_id?: string | null
          scheduled_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      automation_folders: {
        Row: {
          brand_id: string
          color: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          parent_id: string | null
          position: number
          updated_at: string
        }
        Insert: {
          brand_id: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          parent_id?: string | null
          position?: number
          updated_at?: string
        }
        Update: {
          brand_id?: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "automation_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_node_messages: {
        Row: {
          automation_id: string
          brand_id: string
          button_clicked_at: string | null
          button_payload: Json | null
          channel_id: string | null
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          delivered_at: string | null
          error_code: string | null
          error_message: string | null
          failed_at: string | null
          id: string
          node_id: string
          node_type: string
          read_at: string | null
          replied_at: string | null
          run_id: string | null
          sent_at: string
          template_name: string | null
          wa_message_id: string | null
        }
        Insert: {
          automation_id: string
          brand_id: string
          button_clicked_at?: string | null
          button_payload?: Json | null
          channel_id?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          delivered_at?: string | null
          error_code?: string | null
          error_message?: string | null
          failed_at?: string | null
          id?: string
          node_id: string
          node_type: string
          read_at?: string | null
          replied_at?: string | null
          run_id?: string | null
          sent_at?: string
          template_name?: string | null
          wa_message_id?: string | null
        }
        Update: {
          automation_id?: string
          brand_id?: string
          button_clicked_at?: string | null
          button_payload?: Json | null
          channel_id?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          delivered_at?: string | null
          error_code?: string | null
          error_message?: string | null
          failed_at?: string | null
          id?: string
          node_id?: string
          node_type?: string
          read_at?: string | null
          replied_at?: string | null
          run_id?: string | null
          sent_at?: string
          template_name?: string | null
          wa_message_id?: string | null
        }
        Relationships: []
      }
      automation_run_steps: {
        Row: {
          error: string | null
          executed_at: string
          id: string
          node_id: string
          node_type: string
          payload: Json | null
          run_id: string
        }
        Insert: {
          error?: string | null
          executed_at?: string
          id?: string
          node_id: string
          node_type: string
          payload?: Json | null
          run_id: string
        }
        Update: {
          error?: string | null
          executed_at?: string
          id?: string
          node_id?: string
          node_type?: string
          payload?: Json | null
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_run_steps_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "automation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_runs: {
        Row: {
          automation_id: string
          brand_id: string
          contact_id: string | null
          conversation_id: string | null
          current_node_id: string | null
          finished_at: string | null
          id: string
          last_error: string | null
          started_at: string
          status: Database["public"]["Enums"]["automation_run_status"]
          updated_at: string
          variables: Json
        }
        Insert: {
          automation_id: string
          brand_id: string
          contact_id?: string | null
          conversation_id?: string | null
          current_node_id?: string | null
          finished_at?: string | null
          id?: string
          last_error?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["automation_run_status"]
          updated_at?: string
          variables?: Json
        }
        Update: {
          automation_id?: string
          brand_id?: string
          contact_id?: string | null
          conversation_id?: string | null
          current_node_id?: string | null
          finished_at?: string | null
          id?: string
          last_error?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["automation_run_status"]
          updated_at?: string
          variables?: Json
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_scheduled_steps: {
        Row: {
          created_at: string
          id: string
          resume_at: string
          run_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          resume_at: string
          run_id: string
        }
        Update: {
          created_at?: string
          id?: string
          resume_at?: string
          run_id?: string
        }
        Relationships: []
      }
      automations: {
        Row: {
          brand_id: string
          created_at: string
          created_by: string | null
          description: string | null
          folder_id: string | null
          graph: Json
          id: string
          name: string
          status: Database["public"]["Enums"]["automation_status"]
          trigger_config: Json
          trigger_tag: string | null
          trigger_template_id: string | null
          trigger_type: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          folder_id?: string | null
          graph?: Json
          id?: string
          name: string
          status?: Database["public"]["Enums"]["automation_status"]
          trigger_config?: Json
          trigger_tag?: string | null
          trigger_template_id?: string | null
          trigger_type?: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          folder_id?: string | null
          graph?: Json
          id?: string
          name?: string
          status?: Database["public"]["Enums"]["automation_status"]
          trigger_config?: Json
          trigger_tag?: string | null
          trigger_template_id?: string | null
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automations_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automations_trigger_template_id_fkey"
            columns: ["trigger_template_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_api_keys: {
        Row: {
          brand_id: string
          created_at: string
          created_by: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
        }
        Insert: {
          brand_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
        }
        Update: {
          brand_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_api_keys_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_channels: {
        Row: {
          active: boolean
          app_id: string | null
          brand_id: string
          business_id: string | null
          created_at: string
          id: string
          last_webhook_at: string | null
          name: string
          offhours_message: string | null
          phone_number: string | null
          phone_number_id: string | null
          registered_at: string | null
          registration_last_error: string | null
          round_robin_enabled: boolean
          templates_last_error: string | null
          templates_last_sync_at: string | null
          token_last_error: string | null
          token_last_validated_at: string | null
          token_valid: boolean
          type: Database["public"]["Enums"]["team_type"]
          updated_at: string
          use_global_webhook: boolean
          waba_id: string | null
          webhook_verify_token: string
        }
        Insert: {
          active?: boolean
          app_id?: string | null
          brand_id: string
          business_id?: string | null
          created_at?: string
          id?: string
          last_webhook_at?: string | null
          name: string
          offhours_message?: string | null
          phone_number?: string | null
          phone_number_id?: string | null
          registered_at?: string | null
          registration_last_error?: string | null
          round_robin_enabled?: boolean
          templates_last_error?: string | null
          templates_last_sync_at?: string | null
          token_last_error?: string | null
          token_last_validated_at?: string | null
          token_valid?: boolean
          type: Database["public"]["Enums"]["team_type"]
          updated_at?: string
          use_global_webhook?: boolean
          waba_id?: string | null
          webhook_verify_token?: string
        }
        Update: {
          active?: boolean
          app_id?: string | null
          brand_id?: string
          business_id?: string | null
          created_at?: string
          id?: string
          last_webhook_at?: string | null
          name?: string
          offhours_message?: string | null
          phone_number?: string | null
          phone_number_id?: string | null
          registered_at?: string | null
          registration_last_error?: string | null
          round_robin_enabled?: boolean
          templates_last_error?: string | null
          templates_last_sync_at?: string | null
          token_last_error?: string | null
          token_last_validated_at?: string | null
          token_valid?: boolean
          type?: Database["public"]["Enums"]["team_type"]
          updated_at?: string
          use_global_webhook?: boolean
          waba_id?: string | null
          webhook_verify_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_channels_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_media_library: {
        Row: {
          brand_id: string
          created_at: string
          created_by: string | null
          filename: string | null
          id: string
          kind: string
          mime: string
          size_bytes: number | null
          source: string
          storage_path: string
          url: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          created_by?: string | null
          filename?: string | null
          id?: string
          kind: string
          mime: string
          size_bytes?: number | null
          source?: string
          storage_path: string
          url: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          created_by?: string | null
          filename?: string | null
          id?: string
          kind?: string
          mime?: string
          size_bytes?: number | null
          source?: string
          storage_path?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_media_library_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          active: boolean
          ai_humanize: Json
          bsuid_mode: string
          created_at: string
          description: string | null
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          ai_humanize?: Json
          bsuid_mode?: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          ai_humanize?: Json
          bsuid_mode?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      broadcast_dispatch_queue: {
        Row: {
          attempts: number
          automation_id: string
          brand_id: string
          broadcast_id: string
          claimed_at: string | null
          contact_id: string
          contact_name: string | null
          conversation_id: string | null
          created_at: string
          dispatched_at: string | null
          id: string
          last_error: string | null
          next_attempt_at: string
          phone: string | null
          scheduled_send_at: string
          status: string
          target_id: string
          updated_at: string
          wa_id: string | null
        }
        Insert: {
          attempts?: number
          automation_id: string
          brand_id: string
          broadcast_id: string
          claimed_at?: string | null
          contact_id: string
          contact_name?: string | null
          conversation_id?: string | null
          created_at?: string
          dispatched_at?: string | null
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          phone?: string | null
          scheduled_send_at?: string
          status?: string
          target_id: string
          updated_at?: string
          wa_id?: string | null
        }
        Update: {
          attempts?: number
          automation_id?: string
          brand_id?: string
          broadcast_id?: string
          claimed_at?: string | null
          contact_id?: string
          contact_name?: string | null
          conversation_id?: string | null
          created_at?: string
          dispatched_at?: string | null
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          phone?: string | null
          scheduled_send_at?: string
          status?: string
          target_id?: string
          updated_at?: string
          wa_id?: string | null
        }
        Relationships: []
      }
      broadcast_health_snapshots: {
        Row: {
          actual_rate_1m: number
          broadcast_id: string
          captured_at: string
          configured_rate: number
          dispatched_total: number
          failed_total: number
          id: string
          lag_ratio: number
          notes: string | null
          pending_total: number
          processing_total: number
          tokens_available: number
          under_target: boolean
        }
        Insert: {
          actual_rate_1m?: number
          broadcast_id: string
          captured_at?: string
          configured_rate: number
          dispatched_total?: number
          failed_total?: number
          id?: string
          lag_ratio?: number
          notes?: string | null
          pending_total?: number
          processing_total?: number
          tokens_available?: number
          under_target?: boolean
        }
        Update: {
          actual_rate_1m?: number
          broadcast_id?: string
          captured_at?: string
          configured_rate?: number
          dispatched_total?: number
          failed_total?: number
          id?: string
          lag_ratio?: number
          notes?: string | null
          pending_total?: number
          processing_total?: number
          tokens_available?: number
          under_target?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_health_snapshots_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "broadcasts"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_rate_state: {
        Row: {
          broadcast_id: string
          last_refill_at: string
          tokens: number
          updated_at: string
        }
        Insert: {
          broadcast_id: string
          last_refill_at?: string
          tokens?: number
          updated_at?: string
        }
        Update: {
          broadcast_id?: string
          last_refill_at?: string
          tokens?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_rate_state_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: true
            referencedRelation: "broadcasts"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_runtime_locks: {
        Row: {
          locked_until: string
          name: string
          owner: string
          updated_at: string
        }
        Insert: {
          locked_until: string
          name: string
          owner: string
          updated_at?: string
        }
        Update: {
          locked_until?: string
          name?: string
          owner?: string
          updated_at?: string
        }
        Relationships: []
      }
      broadcast_targets: {
        Row: {
          broadcast_id: string
          claimed_at: string | null
          contact_id: string
          created_at: string
          dispatched_at: string | null
          error: string | null
          id: string
          run_id: string | null
          status: Database["public"]["Enums"]["broadcast_target_status"]
        }
        Insert: {
          broadcast_id: string
          claimed_at?: string | null
          contact_id: string
          created_at?: string
          dispatched_at?: string | null
          error?: string | null
          id?: string
          run_id?: string | null
          status?: Database["public"]["Enums"]["broadcast_target_status"]
        }
        Update: {
          broadcast_id?: string
          claimed_at?: string | null
          contact_id?: string
          created_at?: string
          dispatched_at?: string | null
          error?: string | null
          id?: string
          run_id?: string | null
          status?: Database["public"]["Enums"]["broadcast_target_status"]
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_targets_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "broadcasts"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcasts: {
        Row: {
          audience_filter: Json
          automation_id: string
          brand_id: string
          created_at: string
          created_by: string | null
          dispatched_count: number
          failed_count: number
          finished_at: string | null
          id: string
          name: string
          rate_per_minute: number
          scheduled_at: string | null
          skip_no_window: boolean
          skipped_count: number
          started_at: string | null
          status: Database["public"]["Enums"]["broadcast_status"]
          total_targets: number
          updated_at: string
        }
        Insert: {
          audience_filter?: Json
          automation_id: string
          brand_id: string
          created_at?: string
          created_by?: string | null
          dispatched_count?: number
          failed_count?: number
          finished_at?: string | null
          id?: string
          name: string
          rate_per_minute?: number
          scheduled_at?: string | null
          skip_no_window?: boolean
          skipped_count?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["broadcast_status"]
          total_targets?: number
          updated_at?: string
        }
        Update: {
          audience_filter?: Json
          automation_id?: string
          brand_id?: string
          created_at?: string
          created_by?: string | null
          dispatched_count?: number
          failed_count?: number
          finished_at?: string | null
          id?: string
          name?: string
          rate_per_minute?: number
          scheduled_at?: string | null
          skip_no_window?: boolean
          skipped_count?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["broadcast_status"]
          total_targets?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcasts_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcasts_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_agent_rr_state: {
        Row: {
          channel_id: string
          current_weight: number
          updated_at: string
          user_id: string
        }
        Insert: {
          channel_id: string
          current_weight?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          channel_id?: string
          current_weight?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      channel_agents: {
        Row: {
          channel_id: string
          created_at: string
          user_id: string
          weight: number
        }
        Insert: {
          channel_id: string
          created_at?: string
          user_id: string
          weight?: number
        }
        Update: {
          channel_id?: string
          created_at?: string
          user_id?: string
          weight?: number
        }
        Relationships: []
      }
      channel_secrets: {
        Row: {
          channel_id: string
          system_user_token: string
          updated_at: string
        }
        Insert: {
          channel_id: string
          system_user_token: string
          updated_at?: string
        }
        Update: {
          channel_id?: string
          system_user_token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_secrets_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: true
            referencedRelation: "brand_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_blocklist: {
        Row: {
          brand_id: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          reason: string | null
          value: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          reason?: string | null
          value: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          reason?: string | null
          value?: string
        }
        Relationships: []
      }
      contact_import_batches: {
        Row: {
          attempts: number
          batch_index: number
          claimed_at: string | null
          created_at: string
          error: string | null
          id: string
          import_id: string
          payload: Json
          processed_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          batch_index: number
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          import_id: string
          payload: Json
          processed_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          batch_index?: number
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          import_id?: string
          payload?: Json
          processed_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_import_batches_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "contact_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_import_logs: {
        Row: {
          created_at: string
          id: string
          import_id: string
          level: string
          message: string
          row_index: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          import_id: string
          level?: string
          message: string
          row_index?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          import_id?: string
          level?: string
          message?: string
          row_index?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_import_logs_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "contact_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_imports: {
        Row: {
          brand_id: string
          created_at: string
          created_by: string | null
          created_count: number
          error_count: number
          error_message: string | null
          filename: string | null
          finished_at: string | null
          id: string
          processed_rows: number
          skipped_count: number
          started_at: string | null
          status: string
          tag_ids: string[]
          total_rows: number
          update_existing: boolean
          updated_at: string
          updated_count: number
        }
        Insert: {
          brand_id: string
          created_at?: string
          created_by?: string | null
          created_count?: number
          error_count?: number
          error_message?: string | null
          filename?: string | null
          finished_at?: string | null
          id?: string
          processed_rows?: number
          skipped_count?: number
          started_at?: string | null
          status?: string
          tag_ids?: string[]
          total_rows?: number
          update_existing?: boolean
          updated_at?: string
          updated_count?: number
        }
        Update: {
          brand_id?: string
          created_at?: string
          created_by?: string | null
          created_count?: number
          error_count?: number
          error_message?: string | null
          filename?: string | null
          finished_at?: string | null
          id?: string
          processed_rows?: number
          skipped_count?: number
          started_at?: string | null
          status?: string
          tag_ids?: string[]
          total_rows?: number
          update_existing?: boolean
          updated_at?: string
          updated_count?: number
        }
        Relationships: []
      }
      contact_tag_events: {
        Row: {
          actor_id: string | null
          brand_id: string
          contact_id: string
          created_at: string
          event_type: string
          id: string
          tag_id: string | null
          tag_name: string
        }
        Insert: {
          actor_id?: string | null
          brand_id: string
          contact_id: string
          created_at?: string
          event_type: string
          id?: string
          tag_id?: string | null
          tag_name: string
        }
        Update: {
          actor_id?: string | null
          brand_id?: string
          contact_id?: string
          created_at?: string
          event_type?: string
          id?: string
          tag_id?: string | null
          tag_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_tag_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_tags: {
        Row: {
          contact_id: string
          created_at: string
          tag_id: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          tag_id: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          brand_id: string
          bsuid: string | null
          created_at: string
          id: string
          metadata: Json
          name: string | null
          phone: string | null
          profile_name: string | null
          updated_at: string
          username: string | null
          wa_id: string | null
          webchat_visitor_id: string | null
        }
        Insert: {
          brand_id: string
          bsuid?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          name?: string | null
          phone?: string | null
          profile_name?: string | null
          updated_at?: string
          username?: string | null
          wa_id?: string | null
          webchat_visitor_id?: string | null
        }
        Update: {
          brand_id?: string
          bsuid?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          name?: string | null
          phone?: string | null
          profile_name?: string | null
          updated_at?: string
          username?: string | null
          wa_id?: string | null
          webchat_visitor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_events: {
        Row: {
          actor_id: string | null
          conversation_id: string
          created_at: string
          event_type: string
          id: string
          payload: Json
        }
        Insert: {
          actor_id?: string | null
          conversation_id: string
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
        }
        Update: {
          actor_id?: string | null
          conversation_id?: string
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "conversation_events_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          ai_agent_id: string | null
          assigned_to: string | null
          brand_id: string
          channel_id: string
          contact_id: string
          created_at: string
          id: string
          last_inbound_at: string | null
          last_message_at: string | null
          status: Database["public"]["Enums"]["conversation_status"]
          unread_count: number
          updated_at: string
          window_expires_at: string | null
        }
        Insert: {
          ai_agent_id?: string | null
          assigned_to?: string | null
          brand_id: string
          channel_id: string
          contact_id: string
          created_at?: string
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          status?: Database["public"]["Enums"]["conversation_status"]
          unread_count?: number
          updated_at?: string
          window_expires_at?: string | null
        }
        Update: {
          ai_agent_id?: string | null
          assigned_to?: string | null
          brand_id?: string
          channel_id?: string
          contact_id?: string
          created_at?: string
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          status?: Database["public"]["Enums"]["conversation_status"]
          unread_count?: number
          updated_at?: string
          window_expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_ai_agent_id_fkey"
            columns: ["ai_agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "brand_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_audit_log: {
        Row: {
          args: Json
          brand_id: string
          created_at: string
          error: string | null
          id: string
          ok: boolean
          result: Json | null
          thread_id: string | null
          tool: string
          user_id: string
        }
        Insert: {
          args?: Json
          brand_id: string
          created_at?: string
          error?: string | null
          id?: string
          ok?: boolean
          result?: Json | null
          thread_id?: string | null
          tool: string
          user_id: string
        }
        Update: {
          args?: Json
          brand_id?: string
          created_at?: string
          error?: string | null
          id?: string
          ok?: boolean
          result?: Json | null
          thread_id?: string | null
          tool?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_audit_log_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_audit_log_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "copilot_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_messages: {
        Row: {
          created_at: string
          id: string
          parts: Json
          role: string
          sdk_message_id: string
          seq: number
          thread_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          parts?: Json
          role: string
          sdk_message_id: string
          seq?: number
          thread_id: string
        }
        Update: {
          created_at?: string
          id?: string
          parts?: Json
          role?: string
          sdk_message_id?: string
          seq?: number
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "copilot_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_threads: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          last_message_at: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          last_message_at?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          last_message_at?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_threads_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_fields: {
        Row: {
          brand_id: string
          created_at: string
          created_by: string | null
          id: string
          key: string
          label: string
          options: Json
          position: number
          type: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          key: string
          label: string
          options?: Json
          position?: number
          type?: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          key?: string
          label?: string
          options?: Json
          position?: number
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      ellie_buyer_validations: {
        Row: {
          active: boolean
          brand_id: string
          created_at: string
          created_by: string | null
          email: string
          full_name: string | null
          id: string
          matched_product_ids: string[]
          notes: string | null
          phone: string | null
          product: string | null
          raw_response: Json | null
          source: string
          updated_at: string
          validated_at: string | null
        }
        Insert: {
          active?: boolean
          brand_id: string
          created_at?: string
          created_by?: string | null
          email: string
          full_name?: string | null
          id?: string
          matched_product_ids?: string[]
          notes?: string | null
          phone?: string | null
          product?: string | null
          raw_response?: Json | null
          source?: string
          updated_at?: string
          validated_at?: string | null
        }
        Update: {
          active?: boolean
          brand_id?: string
          created_at?: string
          created_by?: string | null
          email?: string
          full_name?: string | null
          id?: string
          matched_product_ids?: string[]
          notes?: string | null
          phone?: string | null
          product?: string | null
          raw_response?: Json | null
          source?: string
          updated_at?: string
          validated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ellie_buyer_validations_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      ellie_hotmart_products: {
        Row: {
          active: boolean
          brand_id: string
          created_at: string
          created_by: string | null
          id: string
          label: string | null
          product_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          brand_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          product_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          brand_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ellie_hotmart_products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      ellie_hotmart_tokens: {
        Row: {
          access_token: string
          brand_id: string
          expires_at: string
          id: string
          updated_at: string
        }
        Insert: {
          access_token: string
          brand_id: string
          expires_at: string
          id?: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          brand_id?: string
          expires_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ellie_hotmart_tokens_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: true
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      ellie_lead_offers: {
        Row: {
          active: boolean
          agent_id: string
          brand_id: string
          checkout_url: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          image_url: string | null
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          agent_id: string
          brand_id: string
          checkout_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          agent_id?: string
          brand_id?: string
          checkout_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ellie_lead_offers_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ellie_lead_offers_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      ellie_lead_usage: {
        Row: {
          agent_id: string
          brand_id: string
          contact_id: string
          created_at: string
          id: string
          last_message_at: string | null
          messages_used: number
          updated_at: string
        }
        Insert: {
          agent_id: string
          brand_id: string
          contact_id: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          messages_used?: number
          updated_at?: string
        }
        Update: {
          agent_id?: string
          brand_id?: string
          contact_id?: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          messages_used?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ellie_lead_usage_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ellie_lead_usage_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ellie_lead_usage_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      error_logs: {
        Row: {
          acknowledged: boolean
          acknowledged_at: string | null
          acknowledged_by: string | null
          brand_id: string | null
          category: string
          code: string
          conversation_id: string | null
          created_at: string
          id: string
          message_id: string | null
          message_pt: string
          payload: Json | null
          severity: Database["public"]["Enums"]["error_severity"]
          technical_message: string | null
          user_id: string | null
        }
        Insert: {
          acknowledged?: boolean
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          brand_id?: string | null
          category: string
          code: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          message_id?: string | null
          message_pt: string
          payload?: Json | null
          severity: Database["public"]["Enums"]["error_severity"]
          technical_message?: string | null
          user_id?: string | null
        }
        Update: {
          acknowledged?: boolean
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          brand_id?: string | null
          category?: string
          code?: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          message_id?: string | null
          message_pt?: string
          payload?: Json | null
          severity?: Database["public"]["Enums"]["error_severity"]
          technical_message?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "error_logs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "error_logs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "error_logs_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_account_brands: {
        Row: {
          account_id: string
          brand_id: string
          created_at: string
        }
        Insert: {
          account_id: string
          brand_id: string
          created_at?: string
        }
        Update: {
          account_id?: string
          brand_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_account_brands_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "integration_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_accounts: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          credentials: Json
          dispatch_concurrency: number
          id: string
          last_drain_at: string | null
          last_error: string | null
          last_event_at: string | null
          last_polled_at: string | null
          name: string
          platform: Database["public"]["Enums"]["integration_platform"]
          polling_enabled: boolean
          queue_paused: boolean
          rate_limit_burst: number
          rate_limit_per_minute: number
          status: Database["public"]["Enums"]["integration_account_status"]
          updated_at: string
          webhook_secret: string
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          credentials?: Json
          dispatch_concurrency?: number
          id?: string
          last_drain_at?: string | null
          last_error?: string | null
          last_event_at?: string | null
          last_polled_at?: string | null
          name: string
          platform: Database["public"]["Enums"]["integration_platform"]
          polling_enabled?: boolean
          queue_paused?: boolean
          rate_limit_burst?: number
          rate_limit_per_minute?: number
          status?: Database["public"]["Enums"]["integration_account_status"]
          updated_at?: string
          webhook_secret?: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          credentials?: Json
          dispatch_concurrency?: number
          id?: string
          last_drain_at?: string | null
          last_error?: string | null
          last_event_at?: string | null
          last_polled_at?: string | null
          name?: string
          platform?: Database["public"]["Enums"]["integration_platform"]
          polling_enabled?: boolean
          queue_paused?: boolean
          rate_limit_burst?: number
          rate_limit_per_minute?: number
          status?: Database["public"]["Enums"]["integration_account_status"]
          updated_at?: string
          webhook_secret?: string
        }
        Relationships: []
      }
      integration_event_queue: {
        Row: {
          account_id: string
          attempts: number
          event_type: string | null
          external_id: string | null
          finished_at: string | null
          id: string
          last_error: string | null
          next_attempt_at: string
          payload: Json
          platform: Database["public"]["Enums"]["integration_platform"]
          received_at: string
          signature_header: string | null
          started_at: string | null
          status: string
        }
        Insert: {
          account_id: string
          attempts?: number
          event_type?: string | null
          external_id?: string | null
          finished_at?: string | null
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          payload: Json
          platform: Database["public"]["Enums"]["integration_platform"]
          received_at?: string
          signature_header?: string | null
          started_at?: string | null
          status?: string
        }
        Update: {
          account_id?: string
          attempts?: number
          event_type?: string | null
          external_id?: string | null
          finished_at?: string | null
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          payload?: Json
          platform?: Database["public"]["Enums"]["integration_platform"]
          received_at?: string
          signature_header?: string | null
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_event_queue_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "integration_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_events: {
        Row: {
          account_id: string
          automations_started: number
          brand_id: string | null
          contact_id: string | null
          created_at: string
          error: string | null
          event_type: string
          external_id: string | null
          id: string
          payload: Json
          platform: Database["public"]["Enums"]["integration_platform"]
          processed_at: string | null
          product_external_id: string | null
        }
        Insert: {
          account_id: string
          automations_started?: number
          brand_id?: string | null
          contact_id?: string | null
          created_at?: string
          error?: string | null
          event_type: string
          external_id?: string | null
          id?: string
          payload?: Json
          platform: Database["public"]["Enums"]["integration_platform"]
          processed_at?: string | null
          product_external_id?: string | null
        }
        Update: {
          account_id?: string
          automations_started?: number
          brand_id?: string | null
          contact_id?: string | null
          created_at?: string
          error?: string | null
          event_type?: string
          external_id?: string | null
          id?: string
          payload?: Json
          platform?: Database["public"]["Enums"]["integration_platform"]
          processed_at?: string | null
          product_external_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "integration_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_global_limits: {
        Row: {
          auto_throttle_tier: string | null
          auto_throttle_until: string | null
          distribution_mode: string
          global_burst: number
          global_rate_limit_per_minute: number
          id: boolean
          min_share_per_account: number
          tier: string
          updated_at: string
        }
        Insert: {
          auto_throttle_tier?: string | null
          auto_throttle_until?: string | null
          distribution_mode?: string
          global_burst?: number
          global_rate_limit_per_minute?: number
          id?: boolean
          min_share_per_account?: number
          tier?: string
          updated_at?: string
        }
        Update: {
          auto_throttle_tier?: string | null
          auto_throttle_until?: string | null
          distribution_mode?: string
          global_burst?: number
          global_rate_limit_per_minute?: number
          id?: boolean
          min_share_per_account?: number
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      integration_products: {
        Row: {
          account_id: string
          created_at: string
          external_id: string
          id: string
          last_synced_at: string | null
          metadata: Json
          name: string
          type: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          external_id: string
          id?: string
          last_synced_at?: string | null
          metadata?: Json
          name: string
          type?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          external_id?: string
          id?: string
          last_synced_at?: string | null
          metadata?: Json
          name?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_products_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "integration_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_queue_health_snapshots: {
        Row: {
          failed_last_min: number
          level: string
          pending: number
          processed_last_min: number
          processing: number
          reasons: Json
          taken_at: string
          tier: string | null
        }
        Insert: {
          failed_last_min?: number
          level?: string
          pending?: number
          processed_last_min?: number
          processing?: number
          reasons?: Json
          taken_at?: string
          tier?: string | null
        }
        Update: {
          failed_last_min?: number
          level?: string
          pending?: number
          processed_last_min?: number
          processing?: number
          reasons?: Json
          taken_at?: string
          tier?: string | null
        }
        Relationships: []
      }
      internal_notes: {
        Row: {
          author_id: string
          body: string
          conversation_id: string
          created_at: string
          id: string
        }
        Insert: {
          author_id: string
          body: string
          conversation_id: string
          created_at?: string
          id?: string
        }
        Update: {
          author_id?: string
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "internal_notes_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          brand_id: string
          channel_id: string | null
          content: string | null
          conversation_id: string
          created_at: string
          direction: Database["public"]["Enums"]["message_direction"]
          error_code: string | null
          error_message: string | null
          id: string
          media_filename: string | null
          media_mime: string | null
          media_size_bytes: number | null
          media_url: string | null
          raw: Json | null
          reply_to_wa_id: string | null
          sent_by: string | null
          status: Database["public"]["Enums"]["message_status"]
          template_language: string | null
          template_name: string | null
          template_variables: Json | null
          type: Database["public"]["Enums"]["message_type"]
          updated_at: string
          wa_message_id: string | null
        }
        Insert: {
          brand_id: string
          channel_id?: string | null
          content?: string | null
          conversation_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["message_direction"]
          error_code?: string | null
          error_message?: string | null
          id?: string
          media_filename?: string | null
          media_mime?: string | null
          media_size_bytes?: number | null
          media_url?: string | null
          raw?: Json | null
          reply_to_wa_id?: string | null
          sent_by?: string | null
          status?: Database["public"]["Enums"]["message_status"]
          template_language?: string | null
          template_name?: string | null
          template_variables?: Json | null
          type: Database["public"]["Enums"]["message_type"]
          updated_at?: string
          wa_message_id?: string | null
        }
        Update: {
          brand_id?: string
          channel_id?: string | null
          content?: string | null
          conversation_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["message_direction"]
          error_code?: string | null
          error_message?: string | null
          id?: string
          media_filename?: string | null
          media_mime?: string | null
          media_size_bytes?: number | null
          media_url?: string | null
          raw?: Json | null
          reply_to_wa_id?: string | null
          sent_by?: string | null
          status?: Database["public"]["Enums"]["message_status"]
          template_language?: string | null
          template_name?: string | null
          template_variables?: Json | null
          type?: Database["public"]["Enums"]["message_type"]
          updated_at?: string
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "brand_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_contact_activities: {
        Row: {
          activity_id: string | null
          brand_id: string
          cancel_reason: string | null
          contact_id: string
          created_at: string
          due_at: string
          error_message: string | null
          executed_at: string | null
          executed_by: string | null
          id: string
          kind: string
          message_text: string | null
          mode: string
          name: string
          pipeline_contact_id: string
          pipeline_id: string
          stage_id: string
          status: string
          target_stage_id: string | null
          template_id: string | null
          template_variables: Json
          updated_at: string
          wa_message_id: string | null
        }
        Insert: {
          activity_id?: string | null
          brand_id: string
          cancel_reason?: string | null
          contact_id: string
          created_at?: string
          due_at: string
          error_message?: string | null
          executed_at?: string | null
          executed_by?: string | null
          id?: string
          kind: string
          message_text?: string | null
          mode: string
          name?: string
          pipeline_contact_id: string
          pipeline_id: string
          stage_id: string
          status?: string
          target_stage_id?: string | null
          template_id?: string | null
          template_variables?: Json
          updated_at?: string
          wa_message_id?: string | null
        }
        Update: {
          activity_id?: string | null
          brand_id?: string
          cancel_reason?: string | null
          contact_id?: string
          created_at?: string
          due_at?: string
          error_message?: string | null
          executed_at?: string | null
          executed_by?: string | null
          id?: string
          kind?: string
          message_text?: string | null
          mode?: string
          name?: string
          pipeline_contact_id?: string
          pipeline_id?: string
          stage_id?: string
          status?: string
          target_stage_id?: string | null
          template_id?: string | null
          template_variables?: Json
          updated_at?: string
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_contact_activities_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stage_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_contact_activities_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_contact_activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_contact_activities_pipeline_contact_id_fkey"
            columns: ["pipeline_contact_id"]
            isOneToOne: false
            referencedRelation: "pipeline_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_contact_activities_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_contact_activities_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_contact_activities_target_stage_id_fkey"
            columns: ["target_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_contact_events: {
        Row: {
          actor_id: string | null
          brand_id: string
          contact_id: string
          created_at: string
          event_type: string
          from_stage_id: string | null
          id: string
          pipeline_id: string
          to_stage_id: string | null
        }
        Insert: {
          actor_id?: string | null
          brand_id: string
          contact_id: string
          created_at?: string
          event_type: string
          from_stage_id?: string | null
          id?: string
          pipeline_id: string
          to_stage_id?: string | null
        }
        Update: {
          actor_id?: string | null
          brand_id?: string
          contact_id?: string
          created_at?: string
          event_type?: string
          from_stage_id?: string | null
          id?: string
          pipeline_id?: string
          to_stage_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_contact_events_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_contact_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_contact_events_from_stage_id_fkey"
            columns: ["from_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_contact_events_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_contact_events_to_stage_id_fkey"
            columns: ["to_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_contacts: {
        Row: {
          brand_id: string
          contact_id: string
          created_at: string
          id: string
          moved_at: string
          moved_by: string | null
          pending_ai_agent_id: string | null
          pending_assigned_to: string | null
          pipeline_id: string
          position: number
          stage_id: string
          status: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          contact_id: string
          created_at?: string
          id?: string
          moved_at?: string
          moved_by?: string | null
          pending_ai_agent_id?: string | null
          pending_assigned_to?: string | null
          pipeline_id: string
          position?: number
          stage_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          contact_id?: string
          created_at?: string
          id?: string
          moved_at?: string
          moved_by?: string | null
          pending_ai_agent_id?: string | null
          pending_assigned_to?: string | null
          pipeline_id?: string
          position?: number
          stage_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_contacts_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_contacts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_contacts_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_contacts_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_folders: {
        Row: {
          brand_id: string
          color: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          position: number
          updated_at: string
        }
        Insert: {
          brand_id: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          position?: number
          updated_at?: string
        }
        Update: {
          brand_id?: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_folders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stage_activities: {
        Row: {
          active: boolean
          brand_id: string
          created_at: string
          created_by: string | null
          delay_minutes: number
          id: string
          kind: string
          message_text: string | null
          mode: string
          name: string
          pipeline_id: string
          position: number
          stage_id: string
          target_stage_id: string | null
          template_id: string | null
          template_variables: Json
          updated_at: string
        }
        Insert: {
          active?: boolean
          brand_id: string
          created_at?: string
          created_by?: string | null
          delay_minutes?: number
          id?: string
          kind: string
          message_text?: string | null
          mode?: string
          name?: string
          pipeline_id: string
          position?: number
          stage_id: string
          target_stage_id?: string | null
          template_id?: string | null
          template_variables?: Json
          updated_at?: string
        }
        Update: {
          active?: boolean
          brand_id?: string
          created_at?: string
          created_by?: string | null
          delay_minutes?: number
          id?: string
          kind?: string
          message_text?: string | null
          mode?: string
          name?: string
          pipeline_id?: string
          position?: number
          stage_id?: string
          target_stage_id?: string | null
          template_id?: string | null
          template_variables?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stage_activities_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_stage_activities_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_stage_activities_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_stage_activities_target_stage_id_fkey"
            columns: ["target_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_stage_activities_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          color: string | null
          created_at: string
          id: string
          name: string
          on_enter_status: string
          pipeline_id: string
          position: number
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          name: string
          on_enter_status?: string
          pipeline_id: string
          position?: number
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          on_enter_status?: string
          pipeline_id?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_templates: {
        Row: {
          brand_id: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          stages: Json
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          stages?: Json
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          stages?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_templates_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      pipelines: {
        Row: {
          brand_id: string
          created_at: string
          created_by: string | null
          description: string | null
          distribution_ai_agent_ids: string[]
          distribution_cursor: number
          distribution_mode: string
          distribution_user_ids: string[]
          folder_id: string | null
          id: string
          name: string
          position: number
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          distribution_ai_agent_ids?: string[]
          distribution_cursor?: number
          distribution_mode?: string
          distribution_user_ids?: string[]
          folder_id?: string | null
          id?: string
          name: string
          position?: number
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          distribution_ai_agent_ids?: string[]
          distribution_cursor?: number
          distribution_mode?: string
          distribution_user_ids?: string[]
          folder_id?: string | null
          id?: string
          name?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipelines_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipelines_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "pipeline_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      round_robin_state: {
        Row: {
          channel_id: string
          last_assigned_at: string | null
          last_assigned_user_id: string | null
        }
        Insert: {
          channel_id: string
          last_assigned_at?: string | null
          last_assigned_user_id?: string | null
        }
        Update: {
          channel_id?: string
          last_assigned_at?: string | null
          last_assigned_user_id?: string | null
        }
        Relationships: []
      }
      sales_tracker_codes: {
        Row: {
          active: boolean
          brand_id: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["sales_tracker_code_kind"]
          platform_hint: string | null
          sck: string | null
          tracker_id: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          active?: boolean
          brand_id: string
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["sales_tracker_code_kind"]
          platform_hint?: string | null
          sck?: string | null
          tracker_id: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          active?: boolean
          brand_id?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["sales_tracker_code_kind"]
          platform_hint?: string | null
          sck?: string | null
          tracker_id?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_tracker_codes_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_tracker_codes_tracker_id_fkey"
            columns: ["tracker_id"]
            isOneToOne: false
            referencedRelation: "sales_trackers"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_trackers: {
        Row: {
          active: boolean
          automation_id: string | null
          brand_id: string
          created_at: string
          created_by: string | null
          id: string
          kind: Database["public"]["Enums"]["sales_tracker_kind"]
          name: string
          notes: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          active?: boolean
          automation_id?: string | null
          brand_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: Database["public"]["Enums"]["sales_tracker_kind"]
          name: string
          notes?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          active?: boolean
          automation_id?: string | null
          brand_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["sales_tracker_kind"]
          name?: string
          notes?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_trackers_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_trackers_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_trackers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      tag_folders: {
        Row: {
          brand_id: string
          color: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          position: number
          updated_at: string
        }
        Insert: {
          brand_id: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          position?: number
          updated_at?: string
        }
        Update: {
          brand_id?: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          position?: number
          updated_at?: string
        }
        Relationships: []
      }
      tags: {
        Row: {
          brand_id: string
          color: string | null
          created_at: string
          created_by: string | null
          folder_id: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          folder_id?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          folder_id?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "tag_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      user_quick_replies: {
        Row: {
          content: string
          created_at: string
          id: string
          position: number
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          position?: number
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          position?: number
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wa_send_media_cache: {
        Row: {
          brand_id: string
          created_at: string
          expires_at: string
          id: string
          media_id: string
          mime_type: string | null
          phone_number_id: string
          source_hash: string
          source_url: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          expires_at: string
          id?: string
          media_id: string
          mime_type?: string | null
          phone_number_id: string
          source_hash: string
          source_url: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          media_id?: string
          mime_type?: string | null
          phone_number_id?: string
          source_hash?: string
          source_url?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_send_media_cache_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      webchat_sessions: {
        Row: {
          brand_id: string
          channel_id: string
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          id: string
          ip: string | null
          last_seen_at: string
          merged_into_contact_id: string | null
          page_url: string | null
          session_token: string
          user_agent: string | null
          visitor_email: string | null
          visitor_id: string
          visitor_name: string
          visitor_phone: string | null
          widget_id: string
        }
        Insert: {
          brand_id: string
          channel_id: string
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          ip?: string | null
          last_seen_at?: string
          merged_into_contact_id?: string | null
          page_url?: string | null
          session_token?: string
          user_agent?: string | null
          visitor_email?: string | null
          visitor_id: string
          visitor_name: string
          visitor_phone?: string | null
          widget_id: string
        }
        Update: {
          brand_id?: string
          channel_id?: string
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          ip?: string | null
          last_seen_at?: string
          merged_into_contact_id?: string | null
          page_url?: string | null
          session_token?: string
          user_agent?: string | null
          visitor_email?: string | null
          visitor_id?: string
          visitor_name?: string
          visitor_phone?: string | null
          widget_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webchat_sessions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webchat_sessions_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "brand_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webchat_sessions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webchat_sessions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webchat_sessions_merged_into_contact_id_fkey"
            columns: ["merged_into_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webchat_sessions_widget_id_fkey"
            columns: ["widget_id"]
            isOneToOne: false
            referencedRelation: "webchat_widgets"
            referencedColumns: ["id"]
          },
        ]
      }
      webchat_widgets: {
        Row: {
          active: boolean
          allow_attachments: boolean
          brand_id: string
          business_hours: Json
          channel_id: string
          chat_input_placeholder: string | null
          collect_email: boolean
          created_at: string
          custom_css: string | null
          display_mode: string
          form_email_label: string | null
          form_email_placeholder: string | null
          form_name_label: string | null
          form_name_placeholder: string | null
          form_phone_label: string | null
          form_phone_placeholder: string | null
          form_submit_label: string | null
          header_subtitle_offline: string | null
          header_subtitle_online: string | null
          id: string
          inline_align: string
          inline_fill_container: boolean
          inline_height: number | null
          inline_max_width: number | null
          launcher_size: string
          logo_url: string | null
          offline_message: string
          position: string
          powered_by_label: string | null
          primary_color: string
          require_name: boolean
          require_phone: boolean
          updated_at: string
          welcome_message: string
          widget_title: string
        }
        Insert: {
          active?: boolean
          allow_attachments?: boolean
          brand_id: string
          business_hours?: Json
          channel_id: string
          chat_input_placeholder?: string | null
          collect_email?: boolean
          created_at?: string
          custom_css?: string | null
          display_mode?: string
          form_email_label?: string | null
          form_email_placeholder?: string | null
          form_name_label?: string | null
          form_name_placeholder?: string | null
          form_phone_label?: string | null
          form_phone_placeholder?: string | null
          form_submit_label?: string | null
          header_subtitle_offline?: string | null
          header_subtitle_online?: string | null
          id?: string
          inline_align?: string
          inline_fill_container?: boolean
          inline_height?: number | null
          inline_max_width?: number | null
          launcher_size?: string
          logo_url?: string | null
          offline_message?: string
          position?: string
          powered_by_label?: string | null
          primary_color?: string
          require_name?: boolean
          require_phone?: boolean
          updated_at?: string
          welcome_message?: string
          widget_title?: string
        }
        Update: {
          active?: boolean
          allow_attachments?: boolean
          brand_id?: string
          business_hours?: Json
          channel_id?: string
          chat_input_placeholder?: string | null
          collect_email?: boolean
          created_at?: string
          custom_css?: string | null
          display_mode?: string
          form_email_label?: string | null
          form_email_placeholder?: string | null
          form_name_label?: string | null
          form_name_placeholder?: string | null
          form_phone_label?: string | null
          form_phone_placeholder?: string | null
          form_submit_label?: string | null
          header_subtitle_offline?: string | null
          header_subtitle_online?: string | null
          id?: string
          inline_align?: string
          inline_fill_container?: boolean
          inline_height?: number | null
          inline_max_width?: number | null
          launcher_size?: string
          logo_url?: string | null
          offline_message?: string
          position?: string
          powered_by_label?: string | null
          primary_color?: string
          require_name?: boolean
          require_phone?: boolean
          updated_at?: string
          welcome_message?: string
          widget_title?: string
        }
        Relationships: [
          {
            foreignKeyName: "webchat_widgets_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webchat_widgets_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: true
            referencedRelation: "brand_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events_raw: {
        Row: {
          attempts: number
          brand_id: string | null
          id: string
          last_error: string | null
          payload: Json
          processed: boolean
          processed_at: string | null
          received_at: string
          signature: string | null
        }
        Insert: {
          attempts?: number
          brand_id?: string | null
          id?: string
          last_error?: string | null
          payload: Json
          processed?: boolean
          processed_at?: string | null
          received_at?: string
          signature?: string | null
        }
        Update: {
          attempts?: number
          brand_id?: string | null
          id?: string
          last_error?: string | null
          payload?: Json
          processed?: boolean
          processed_at?: string | null
          received_at?: string
          signature?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_raw_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_templates: {
        Row: {
          brand_id: string
          category: string | null
          channel_id: string | null
          components: Json
          created_at: string
          header_handle: string | null
          header_media_filename: string | null
          header_media_mime: string | null
          header_media_url: string | null
          header_type: string | null
          id: string
          language: string
          meta_template_id: string | null
          name: string
          status: string
          synced_at: string | null
          variable_bindings: Json
          variables_count: number
        }
        Insert: {
          brand_id: string
          category?: string | null
          channel_id?: string | null
          components?: Json
          created_at?: string
          header_handle?: string | null
          header_media_filename?: string | null
          header_media_mime?: string | null
          header_media_url?: string | null
          header_type?: string | null
          id?: string
          language: string
          meta_template_id?: string | null
          name: string
          status?: string
          synced_at?: string | null
          variable_bindings?: Json
          variables_count?: number
        }
        Update: {
          brand_id?: string
          category?: string | null
          channel_id?: string | null
          components?: Json
          created_at?: string
          header_handle?: string | null
          header_media_filename?: string | null
          header_media_mime?: string | null
          header_media_url?: string | null
          header_type?: string | null
          id?: string
          language?: string
          meta_template_id?: string | null
          name?: string
          status?: string
          synced_at?: string | null
          variable_bindings?: Json
          variables_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_templates_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_templates_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "brand_channels"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accessible_brand_ids: { Args: { _user_id: string }; Returns: string[] }
      admin_delete_contacts: { Args: { _ids: string[] }; Returns: number }
      api_logs_for_contact: {
        Args: { _contact_id: string }
        Returns: {
          id: string
        }[]
      }
      assign_pipeline_owner: {
        Args: {
          p_brand_id: string
          p_contact_id: string
          p_pipeline_id: string
        }
        Returns: string
      }
      backfill_stage_activities: {
        Args: { _stage_id: string }
        Returns: undefined
      }
      can_view_contact_assignment: {
        Args: { _brand_id: string; _contact_id: string; _user_id: string }
        Returns: boolean
      }
      check_broadcast_rate_compliance: {
        Args: { _broadcast_id: string }
        Returns: {
          configured: number
          dispatched: number
          minute: string
          ratio: number
          status: string
        }[]
      }
      claim_broadcast_dispatch_queue: {
        Args: { _limit: number }
        Returns: {
          attempts: number
          automation_id: string
          brand_id: string
          broadcast_id: string
          contact_id: string
          contact_name: string
          conversation_id: string
          id: string
          phone: string
          target_id: string
          wa_id: string
        }[]
      }
      claim_broadcast_targets: {
        Args: { _broadcast_id: string; _limit: number }
        Returns: {
          contact_id: string
          id: string
        }[]
      }
      claim_integration_events: {
        Args: { _account_id: string; _limit: number }
        Returns: {
          attempts: number
          id: string
          payload: Json
        }[]
      }
      claim_next_import_batch: {
        Args: { _import_id: string }
        Returns: {
          attempts: number
          batch_index: number
          id: string
          import_id: string
          payload: Json
        }[]
      }
      claim_next_pending_import: {
        Args: never
        Returns: {
          brand_id: string
          created_by: string
          id: string
          tag_ids: string[]
          update_existing: boolean
        }[]
      }
      cleanup_automation_runs: { Args: never; Returns: Json }
      create_broadcast_targets_for_audience: {
        Args: {
          _brand_id: string
          _broadcast_id: string
          _exclude_tag_id?: string
          _include_tag_id?: string
        }
        Returns: number
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_broadcast_dispatches: {
        Args: { _broadcast_id: string; _limit?: number }
        Returns: number
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      expire_stale_waiting_button_runs: {
        Args: never
        Returns: {
          expired_count: number
        }[]
      }
      fail_or_retry_broadcast_dispatch: {
        Args: {
          _error: string
          _max_attempts?: number
          _queue_id: string
          _target_id: string
        }
        Returns: string
      }
      finish_broadcast_dispatch: {
        Args: {
          _conversation_id?: string
          _error?: string
          _queue_id: string
          _run_id?: string
          _status: string
          _target_id: string
        }
        Returns: boolean
      }
      finish_broadcast_dispatches_bulk: {
        Args: { _items: Json }
        Returns: number
      }
      get_broadcast_speed_series: {
        Args: { _broadcast_id: string; _minutes?: number }
        Returns: {
          dispatched: number
          failed: number
          is_partial: boolean
          minute: string
        }[]
      }
      get_broadcast_summary: { Args: { _broadcast_id: string }; Returns: Json }
      get_developer_ids: { Args: never; Returns: string[] }
      get_latest_conversations: {
        Args: { _brand: string; _contact_ids: string[] }
        Returns: {
          contact_id: string
          id: string
          window_expires_at: string
        }[]
      }
      get_pipelines_with_counts: {
        Args: { _brand_id: string }
        Returns: {
          brand_id: string
          brand_name: string
          card_count: number
          description: string
          distribution_ai_agent_ids: string[]
          distribution_mode: string
          distribution_user_ids: string[]
          folder_id: string
          id: string
          name: string
          pos: number
          stage_count: number
        }[]
      }
      get_running_broadcasts_rate_sum: { Args: never; Returns: number }
      get_user_brands: {
        Args: { _user_id: string }
        Returns: {
          id: string
          name: string
          slug: string
        }[]
      }
      has_brand_access: {
        Args: { _brand_id: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      inbox_list_conversations: {
        Args: {
          p_ai_agent_ids?: string[]
          p_assignment?: string
          p_brand_id: string
          p_channel_ids?: string[]
          p_contact_ids?: string[]
          p_cursor_id?: string
          p_cursor_ts?: string
          p_include_none_ai_agent?: boolean
          p_include_none_channel?: boolean
          p_include_none_user?: boolean
          p_limit?: number
          p_search?: string
          p_status?: string
          p_user_ids?: string[]
        }
        Returns: {
          ai_agent_id: string | null
          assigned_to: string | null
          brand_id: string
          channel_id: string
          contact_id: string
          created_at: string
          id: string
          last_inbound_at: string | null
          last_message_at: string | null
          status: Database["public"]["Enums"]["conversation_status"]
          unread_count: number
          updated_at: string
          window_expires_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "conversations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      inbox_overview: {
        Args: { p_assignment?: string; p_brand_id: string; p_status?: string }
        Returns: Json
      }
      increment_conversation_unread: {
        Args: { _conv_id: string; _window_expires_at: string }
        Returns: undefined
      }
      increment_ellie_lead_usage: {
        Args: { _agent_id: string; _brand_id: string; _contact_id: string }
        Returns: number
      }
      increment_import_counters: {
        Args: {
          _created: number
          _errors: number
          _import_id: string
          _processed: number
          _skipped: number
          _updated: number
        }
        Returns: undefined
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_blocked: {
        Args: { _brand: string; _email: string; _phone: string }
        Returns: boolean
      }
      mark_integration_events_done: {
        Args: { _ids: string[] }
        Returns: number
      }
      merge_contact_duplicates: {
        Args: { drop_id: string; keep_id: string }
        Returns: undefined
      }
      merge_conversation_duplicates: {
        Args: { drop_id: string; keep_id: string }
        Returns: undefined
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      pick_next_agent: { Args: { _channel_id: string }; Returns: string }
      pick_next_assignee: {
        Args: { _channel_id: string }
        Returns: {
          id: string
          kind: string
        }[]
      }
      preview_broadcast_audience: {
        Args: {
          _brand_id: string
          _exclude_tag_id?: string
          _include_tag_id?: string
          _sample_limit?: number
        }
        Returns: {
          sample: Json
          total_count: number
        }[]
      }
      promote_processing_with_run: { Args: never; Returns: number }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      reap_stuck_integration_events: {
        Args: { _older_than: string }
        Returns: number
      }
      recount_broadcast_progress: {
        Args: { _broadcast_id: string }
        Returns: undefined
      }
      release_broadcast_dispatch_no_penalty: {
        Args: { _queue_id: string; _reason: string; _target_id: string }
        Returns: undefined
      }
      release_broadcast_dispatches_bulk: {
        Args: { _queue_ids: string[]; _reason: string }
        Returns: number
      }
      release_broadcast_tick_lock: {
        Args: { _owner: string }
        Returns: boolean
      }
      release_named_lock: {
        Args: { _name: string; _owner: string }
        Returns: boolean
      }
      reopen_conversation_on_outbound: {
        Args: { _actor_id: string; _by: string; _conv_id: string }
        Returns: undefined
      }
      requeue_stuck_broadcast_dispatches: { Args: never; Returns: number }
      requeue_stuck_broadcast_targets: { Args: never; Returns: number }
      reset_ellie_lead_usage: {
        Args: { _agent_id: string; _contact_id: string }
        Returns: undefined
      }
      search_contacts_by_tag: {
        Args: {
          _brand_id: string
          _limit?: number
          _offset?: number
          _search?: string
          _sort_by?: string
          _sort_dir?: string
          _tag_id: string
        }
        Returns: {
          brand_id: string
          created_at: string
          email: string
          id: string
          name: string
          phone: string
          profile_name: string
          total_count: number
          wa_id: string
        }[]
      }
      search_contacts_no_tag: {
        Args: {
          _brand_id: string
          _limit?: number
          _offset?: number
          _search?: string
          _sort_by?: string
          _sort_dir?: string
        }
        Returns: {
          brand_id: string
          created_at: string
          email: string
          id: string
          name: string
          phone: string
          profile_name: string
          total_count: number
          wa_id: string
        }[]
      }
      search_pipeline_contacts: {
        Args: {
          _limit?: number
          _pipeline_id: string
          _search: string
          _user_id: string
        }
        Returns: {
          id: string
          name: string
          phone: string
          profile_name: string
          wa_id: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      snapshot_running_broadcast_health: {
        Args: never
        Returns: {
          actual_rate_1m: number
          broadcast_id: string
          configured_rate: number
          dispatched_total: number
          failed_total: number
          lag_ratio: number
          pending_total: number
          processing_total: number
          tokens_available: number
          under_target: boolean
        }[]
      }
      try_acquire_broadcast_tick_lock: {
        Args: { _owner: string; _ttl_seconds?: number }
        Returns: boolean
      }
      try_acquire_named_lock: {
        Args: { _name: string; _owner: string; _ttl_seconds?: number }
        Returns: boolean
      }
      webchat_merge_contacts: {
        Args: { _orphan: string; _principal: string }
        Returns: undefined
      }
      webchat_start_session: {
        Args: {
          p_email?: string
          p_ip?: string
          p_name: string
          p_page_url?: string
          p_phone?: string
          p_user_agent?: string
          p_visitor_id: string
          p_widget_id: string
        }
        Returns: {
          contact_id: string
          conversation_id: string
          is_new: boolean
          session_id: string
          session_token: string
        }[]
      }
    }
    Enums: {
      ai_agent_run_status: "success" | "error" | "escalated" | "rate_limited"
      ai_agent_run_trigger:
        | "automation"
        | "manual_test"
        | "scenario"
        | "assign_block"
        | "message"
      ai_agent_status: "off" | "test" | "on"
      ai_knowledge_product_source: "hotmart" | "shopify" | "manual"
      ai_test_scenario_source: "manual" | "faq"
      ai_test_scenario_status: "pending" | "pass" | "fail" | "error"
      app_role: "admin" | "supervisor" | "agent" | "developer"
      automation_run_status:
        | "waiting"
        | "running"
        | "completed"
        | "failed"
        | "cancelled"
        | "sleeping"
        | "waiting_button"
      automation_status: "draft" | "active" | "inactive"
      broadcast_status:
        | "draft"
        | "scheduled"
        | "running"
        | "completed"
        | "cancelled"
        | "failed"
      broadcast_target_status:
        | "pending"
        | "dispatched"
        | "failed"
        | "skipped"
        | "cancelled"
        | "processing"
      conversation_status: "aberto" | "pendente" | "resolvido"
      error_severity: "info" | "warning" | "error" | "critical"
      integration_account_status: "active" | "inactive" | "error"
      integration_platform:
        | "shopify"
        | "hotmart"
        | "sendflow"
        | "activecampaign"
      message_direction: "inbound" | "outbound"
      message_status: "queued" | "sent" | "delivered" | "read" | "failed"
      message_type:
        | "text"
        | "image"
        | "audio"
        | "video"
        | "document"
        | "template"
        | "sticker"
        | "location"
        | "contacts"
        | "interactive"
        | "reaction"
        | "system"
        | "button"
      presence_status: "online" | "away" | "offline"
      sales_tracker_code_kind: "sck" | "utm"
      sales_tracker_kind: "seller" | "automation"
      team_type: "suporte" | "vendas" | "webchat"
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
      ai_agent_run_status: ["success", "error", "escalated", "rate_limited"],
      ai_agent_run_trigger: [
        "automation",
        "manual_test",
        "scenario",
        "assign_block",
        "message",
      ],
      ai_agent_status: ["off", "test", "on"],
      ai_knowledge_product_source: ["hotmart", "shopify", "manual"],
      ai_test_scenario_source: ["manual", "faq"],
      ai_test_scenario_status: ["pending", "pass", "fail", "error"],
      app_role: ["admin", "supervisor", "agent", "developer"],
      automation_run_status: [
        "waiting",
        "running",
        "completed",
        "failed",
        "cancelled",
        "sleeping",
        "waiting_button",
      ],
      automation_status: ["draft", "active", "inactive"],
      broadcast_status: [
        "draft",
        "scheduled",
        "running",
        "completed",
        "cancelled",
        "failed",
      ],
      broadcast_target_status: [
        "pending",
        "dispatched",
        "failed",
        "skipped",
        "cancelled",
        "processing",
      ],
      conversation_status: ["aberto", "pendente", "resolvido"],
      error_severity: ["info", "warning", "error", "critical"],
      integration_account_status: ["active", "inactive", "error"],
      integration_platform: [
        "shopify",
        "hotmart",
        "sendflow",
        "activecampaign",
      ],
      message_direction: ["inbound", "outbound"],
      message_status: ["queued", "sent", "delivered", "read", "failed"],
      message_type: [
        "text",
        "image",
        "audio",
        "video",
        "document",
        "template",
        "sticker",
        "location",
        "contacts",
        "interactive",
        "reaction",
        "system",
        "button",
      ],
      presence_status: ["online", "away", "offline"],
      sales_tracker_code_kind: ["sck", "utm"],
      sales_tracker_kind: ["seller", "automation"],
      team_type: ["suporte", "vendas", "webchat"],
    },
  },
} as const
