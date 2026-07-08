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
      activities: {
        Row: {
          activity_type: Database["public"]["Enums"]["activity_type"]
          company_id: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          draft_content: string | null
          id: string
          occurred_at: string
          owner_id: string | null
          related_opportunity_id: string | null
          status: Database["public"]["Enums"]["activity_status"]
          summary: string | null
        }
        Insert: {
          activity_type: Database["public"]["Enums"]["activity_type"]
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          draft_content?: string | null
          id?: string
          occurred_at?: string
          owner_id?: string | null
          related_opportunity_id?: string | null
          status?: Database["public"]["Enums"]["activity_status"]
          summary?: string | null
        }
        Update: {
          activity_type?: Database["public"]["Enums"]["activity_type"]
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          draft_content?: string | null
          id?: string
          occurred_at?: string
          owner_id?: string | null
          related_opportunity_id?: string | null
          status?: Database["public"]["Enums"]["activity_status"]
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          agent_name: string
          completed_at: string | null
          errors: Json | null
          id: string
          loop_name: string | null
          records_created: number | null
          records_processed: number | null
          records_updated: number | null
          snapshot_version: string | null
          started_at: string
          status: Database["public"]["Enums"]["agent_run_status"]
          summary: string | null
        }
        Insert: {
          agent_name: string
          completed_at?: string | null
          errors?: Json | null
          id?: string
          loop_name?: string | null
          records_created?: number | null
          records_processed?: number | null
          records_updated?: number | null
          snapshot_version?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["agent_run_status"]
          summary?: string | null
        }
        Update: {
          agent_name?: string
          completed_at?: string | null
          errors?: Json | null
          id?: string
          loop_name?: string | null
          records_created?: number | null
          records_processed?: number | null
          records_updated?: number | null
          snapshot_version?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["agent_run_status"]
          summary?: string | null
        }
        Relationships: []
      }
      approvals: {
        Row: {
          approval_type: string
          assigned_approver: string | null
          created_at: string
          decided_at: string | null
          decision:
            | Database["public"]["Enums"]["approval_recommendation"]
            | null
          decision_notes: string | null
          id: string
          linked_record_id: string | null
          linked_record_type: string | null
          recommendation:
            | Database["public"]["Enums"]["approval_recommendation"]
            | null
          related_opportunity_id: string | null
          requested_by: string | null
          status: Database["public"]["Enums"]["approval_status"]
          updated_at: string
        }
        Insert: {
          approval_type: string
          assigned_approver?: string | null
          created_at?: string
          decided_at?: string | null
          decision?:
            | Database["public"]["Enums"]["approval_recommendation"]
            | null
          decision_notes?: string | null
          id?: string
          linked_record_id?: string | null
          linked_record_type?: string | null
          recommendation?:
            | Database["public"]["Enums"]["approval_recommendation"]
            | null
          related_opportunity_id?: string | null
          requested_by?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
        }
        Update: {
          approval_type?: string
          assigned_approver?: string | null
          created_at?: string
          decided_at?: string | null
          decision?:
            | Database["public"]["Enums"]["approval_recommendation"]
            | null
          decision_notes?: string | null
          id?: string
          linked_record_id?: string | null
          linked_record_type?: string | null
          recommendation?:
            | Database["public"]["Enums"]["approval_recommendation"]
            | null
          related_opportunity_id?: string | null
          requested_by?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approvals_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      artifacts: {
        Row: {
          approved_at: string | null
          artifact_type: Database["public"]["Enums"]["artifact_type"]
          content: Json
          created_at: string
          created_by_agent: string | null
          id: string
          related_opportunity_id: string
          reviewed_by: string | null
          status: Database["public"]["Enums"]["artifact_status"]
          title: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          artifact_type: Database["public"]["Enums"]["artifact_type"]
          content?: Json
          created_at?: string
          created_by_agent?: string | null
          id?: string
          related_opportunity_id: string
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["artifact_status"]
          title: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          artifact_type?: Database["public"]["Enums"]["artifact_type"]
          content?: Json
          created_at?: string
          created_by_agent?: string | null
          id?: string
          related_opportunity_id?: string
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["artifact_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "artifacts_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_role_snapshot: string[] | null
          actor_type: string
          after_value: Json | null
          before_value: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          language: string | null
          reason: string | null
          request_id: string | null
          route: string | null
          timestamp: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role_snapshot?: string[] | null
          actor_type?: string
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          language?: string | null
          reason?: string | null
          request_id?: string | null
          route?: string | null
          timestamp?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role_snapshot?: string[] | null
          actor_type?: string
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          language?: string | null
          reason?: string | null
          request_id?: string | null
          route?: string | null
          timestamp?: string
        }
        Relationships: []
      }
      award_evidence: {
        Row: {
          confidence_score: number | null
          created_at: string
          date_received: string | null
          document_url: string | null
          evidence_type: string | null
          id: string
          linked_record_id: string
          linked_record_type: string
          note: string | null
          source: string | null
          uploaded_by: string | null
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string
          date_received?: string | null
          document_url?: string | null
          evidence_type?: string | null
          id?: string
          linked_record_id: string
          linked_record_type: string
          note?: string | null
          source?: string | null
          uploaded_by?: string | null
        }
        Update: {
          confidence_score?: number | null
          created_at?: string
          date_received?: string | null
          document_url?: string | null
          evidence_type?: string | null
          id?: string
          linked_record_id?: string
          linked_record_type?: string
          note?: string | null
          source?: string | null
          uploaded_by?: string | null
        }
        Relationships: []
      }
      boq_items: {
        Row: {
          boq_id: string
          confidence: Database["public"]["Enums"]["confidence_level"]
          cost_estimate: number | null
          created_at: string
          finish: string | null
          id: string
          illumination: string | null
          item_source: string | null
          location: string | null
          material: string | null
          mounting: string | null
          quantity: number | null
          selling_price: number | null
          sign_type: string
          size: string | null
          sort_order: number | null
          unit_rate: number | null
        }
        Insert: {
          boq_id: string
          confidence?: Database["public"]["Enums"]["confidence_level"]
          cost_estimate?: number | null
          created_at?: string
          finish?: string | null
          id?: string
          illumination?: string | null
          item_source?: string | null
          location?: string | null
          material?: string | null
          mounting?: string | null
          quantity?: number | null
          selling_price?: number | null
          sign_type: string
          size?: string | null
          sort_order?: number | null
          unit_rate?: number | null
        }
        Update: {
          boq_id?: string
          confidence?: Database["public"]["Enums"]["confidence_level"]
          cost_estimate?: number | null
          created_at?: string
          finish?: string | null
          id?: string
          illumination?: string | null
          item_source?: string | null
          location?: string | null
          material?: string | null
          mounting?: string | null
          quantity?: number | null
          selling_price?: number | null
          sign_type?: string
          size?: string | null
          sort_order?: number | null
          unit_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "boq_items_boq_id_fkey"
            columns: ["boq_id"]
            isOneToOne: false
            referencedRelation: "boqs"
            referencedColumns: ["id"]
          },
        ]
      }
      boqs: {
        Row: {
          assumptions: string | null
          created_at: string
          created_by: string | null
          currency: string
          estimated_value: number | null
          file_url: string | null
          id: string
          missing_items: string | null
          notes: string | null
          related_opportunity_id: string
          source: string | null
          source_confidence: Database["public"]["Enums"]["confidence_level"]
          status: Database["public"]["Enums"]["boq_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assumptions?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          estimated_value?: number | null
          file_url?: string | null
          id?: string
          missing_items?: string | null
          notes?: string | null
          related_opportunity_id: string
          source?: string | null
          source_confidence?: Database["public"]["Enums"]["confidence_level"]
          status?: Database["public"]["Enums"]["boq_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assumptions?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          estimated_value?: number | null
          file_url?: string | null
          id?: string
          missing_items?: string | null
          notes?: string | null
          related_opportunity_id?: string
          source?: string | null
          source_confidence?: Database["public"]["Enums"]["confidence_level"]
          status?: Database["public"]["Enums"]["boq_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "boqs_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          account_owner_id: string | null
          account_status: Database["public"]["Enums"]["account_status"]
          company_type: Database["public"]["Enums"]["company_type"]
          cr_number: string | null
          created_at: string
          created_by: string | null
          id: string
          internal_notes: string | null
          last_contact_at: string | null
          name: string
          next_action: string | null
          next_action_due: string | null
          regions: string | null
          relationship_level: string | null
          source: string | null
          updated_at: string
          upsell_notes: string | null
          website: string | null
          website_domain: string | null
        }
        Insert: {
          account_owner_id?: string | null
          account_status?: Database["public"]["Enums"]["account_status"]
          company_type?: Database["public"]["Enums"]["company_type"]
          cr_number?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          internal_notes?: string | null
          last_contact_at?: string | null
          name: string
          next_action?: string | null
          next_action_due?: string | null
          regions?: string | null
          relationship_level?: string | null
          source?: string | null
          updated_at?: string
          upsell_notes?: string | null
          website?: string | null
          website_domain?: string | null
        }
        Update: {
          account_owner_id?: string | null
          account_status?: Database["public"]["Enums"]["account_status"]
          company_type?: Database["public"]["Enums"]["company_type"]
          cr_number?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          internal_notes?: string | null
          last_contact_at?: string | null
          name?: string
          next_action?: string | null
          next_action_due?: string | null
          regions?: string | null
          relationship_level?: string | null
          source?: string | null
          updated_at?: string
          upsell_notes?: string | null
          website?: string | null
          website_domain?: string | null
        }
        Relationships: []
      }
      contacts: {
        Row: {
          authority: Database["public"]["Enums"]["contact_authority"]
          company_id: string | null
          confidence_score: number | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          last_verified_at: string | null
          linkedin: string | null
          location: Database["public"]["Enums"]["contact_location"]
          name: string
          notes: string | null
          owner_id: string | null
          phone: string | null
          source: string | null
          title: string | null
          updated_at: string
          verification_status: Database["public"]["Enums"]["verification_status"]
        }
        Insert: {
          authority?: Database["public"]["Enums"]["contact_authority"]
          company_id?: string | null
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          last_verified_at?: string | null
          linkedin?: string | null
          location?: Database["public"]["Enums"]["contact_location"]
          name: string
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          source?: string | null
          title?: string | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["verification_status"]
        }
        Update: {
          authority?: Database["public"]["Enums"]["contact_authority"]
          company_id?: string | null
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          last_verified_at?: string | null
          linkedin?: string | null
          location?: Database["public"]["Enums"]["contact_location"]
          name?: string
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          source?: string | null
          title?: string | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["verification_status"]
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_sources: {
        Row: {
          confidence_level: Database["public"]["Enums"]["confidence_level"]
          created_at: string
          extracted_summary: string | null
          id: string
          related_opportunity_id: string
          source_date: string | null
          source_title: string
          source_type: string
          source_url: string | null
          vault_path: string | null
        }
        Insert: {
          confidence_level?: Database["public"]["Enums"]["confidence_level"]
          created_at?: string
          extracted_summary?: string | null
          id?: string
          related_opportunity_id: string
          source_date?: string | null
          source_title: string
          source_type: string
          source_url?: string | null
          vault_path?: string | null
        }
        Update: {
          confidence_level?: Database["public"]["Enums"]["confidence_level"]
          created_at?: string
          extracted_summary?: string | null
          id?: string
          related_opportunity_id?: string
          source_date?: string | null
          source_title?: string
          source_type?: string
          source_url?: string | null
          vault_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evidence_sources_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_ups: {
        Row: {
          cadence_tier: Database["public"]["Enums"]["priority_tier"]
          channel: string | null
          created_at: string
          due_date: string
          id: string
          last_contact_at: string | null
          notes: string | null
          opportunity_id: string
          owner_id: string | null
          status: Database["public"]["Enums"]["follow_up_status"]
          updated_at: string
        }
        Insert: {
          cadence_tier?: Database["public"]["Enums"]["priority_tier"]
          channel?: string | null
          created_at?: string
          due_date: string
          id?: string
          last_contact_at?: string | null
          notes?: string | null
          opportunity_id: string
          owner_id?: string | null
          status?: Database["public"]["Enums"]["follow_up_status"]
          updated_at?: string
        }
        Update: {
          cadence_tier?: Database["public"]["Enums"]["priority_tier"]
          channel?: string | null
          created_at?: string
          due_date?: string
          id?: string
          last_contact_at?: string | null
          notes?: string | null
          opportunity_id?: string
          owner_id?: string | null
          status?: Database["public"]["Enums"]["follow_up_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_ups_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      import_approval_queue: {
        Row: {
          action: string
          batch_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision: string | null
          id: string
          reason: string | null
          requested_at: string
          requested_by: string
        }
        Insert: {
          action: string
          batch_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          id?: string
          reason?: string | null
          requested_at?: string
          requested_by: string
        }
        Update: {
          action?: string
          batch_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          id?: string
          reason?: string | null
          requested_at?: string
          requested_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_approval_queue_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          ai_suggestions_enabled: boolean
          approved_at: string | null
          approved_by: string | null
          committed_at: string | null
          created_at: string
          created_by: string
          dry_run: boolean
          duplicate_rows: number
          error_rows: number
          id: string
          notes: string | null
          source_type: string
          status: string
          total_rows: number
          updated_at: string
          valid_rows: number
        }
        Insert: {
          ai_suggestions_enabled?: boolean
          approved_at?: string | null
          approved_by?: string | null
          committed_at?: string | null
          created_at?: string
          created_by: string
          dry_run?: boolean
          duplicate_rows?: number
          error_rows?: number
          id?: string
          notes?: string | null
          source_type?: string
          status?: string
          total_rows?: number
          updated_at?: string
          valid_rows?: number
        }
        Update: {
          ai_suggestions_enabled?: boolean
          approved_at?: string | null
          approved_by?: string | null
          committed_at?: string | null
          created_at?: string
          created_by?: string
          dry_run?: boolean
          duplicate_rows?: number
          error_rows?: number
          id?: string
          notes?: string | null
          source_type?: string
          status?: string
          total_rows?: number
          updated_at?: string
          valid_rows?: number
        }
        Relationships: []
      }
      import_duplicate_candidates: {
        Row: {
          batch_id: string
          confidence: number
          created_at: string
          existing_record_id: string
          existing_table: string
          id: string
          match_type: string
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          row_id: string
        }
        Insert: {
          batch_id: string
          confidence?: number
          created_at?: string
          existing_record_id: string
          existing_table: string
          id?: string
          match_type: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          row_id: string
        }
        Update: {
          batch_id?: string
          confidence?: number
          created_at?: string
          existing_record_id?: string
          existing_table?: string
          id?: string
          match_type?: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          row_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_duplicate_candidates_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_duplicate_candidates_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "import_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      import_errors: {
        Row: {
          batch_id: string
          column_name: string | null
          created_at: string
          error_type: string
          id: string
          message: string
          row_id: string | null
          row_number: number | null
          severity: string
        }
        Insert: {
          batch_id: string
          column_name?: string | null
          created_at?: string
          error_type: string
          id?: string
          message: string
          row_id?: string | null
          row_number?: number | null
          severity?: string
        }
        Update: {
          batch_id?: string
          column_name?: string | null
          created_at?: string
          error_type?: string
          id?: string
          message?: string
          row_id?: string | null
          row_number?: number | null
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_errors_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_errors_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "import_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      import_files: {
        Row: {
          batch_id: string
          column_names: string[] | null
          created_at: string
          file_name: string
          file_size_bytes: number
          file_type: string
          header_row: number
          id: string
          row_count: number | null
          sheet_name: string | null
          storage_path: string
        }
        Insert: {
          batch_id: string
          column_names?: string[] | null
          created_at?: string
          file_name: string
          file_size_bytes: number
          file_type: string
          header_row?: number
          id?: string
          row_count?: number | null
          sheet_name?: string | null
          storage_path: string
        }
        Update: {
          batch_id?: string
          column_names?: string[] | null
          created_at?: string
          file_name?: string
          file_size_bytes?: number
          file_type?: string
          header_row?: number
          id?: string
          row_count?: number | null
          sheet_name?: string | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_files_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      import_mappings: {
        Row: {
          batch_id: string
          created_at: string
          id: string
          is_key: boolean
          source_column: string
          target_column: string
          target_table: string
          transform: string | null
        }
        Insert: {
          batch_id: string
          created_at?: string
          id?: string
          is_key?: boolean
          source_column: string
          target_column: string
          target_table: string
          transform?: string | null
        }
        Update: {
          batch_id?: string
          created_at?: string
          id?: string
          is_key?: boolean
          source_column?: string
          target_column?: string
          target_table?: string
          transform?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_mappings_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      import_record_links: {
        Row: {
          action: string
          batch_id: string
          created_at: string
          id: string
          row_id: string
          target_id: string
          target_table: string
        }
        Insert: {
          action: string
          batch_id: string
          created_at?: string
          id?: string
          row_id: string
          target_id: string
          target_table: string
        }
        Update: {
          action?: string
          batch_id?: string
          created_at?: string
          id?: string
          row_id?: string
          target_id?: string
          target_table?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_record_links_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_record_links_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "import_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      import_rows: {
        Row: {
          batch_id: string
          created_at: string
          file_id: string
          id: string
          mapped_data: Json | null
          raw_data: Json
          row_number: number
          status: string
        }
        Insert: {
          batch_id: string
          created_at?: string
          file_id: string
          id?: string
          mapped_data?: Json | null
          raw_data: Json
          row_number: number
          status?: string
        }
        Update: {
          batch_id?: string
          created_at?: string
          file_id?: string
          id?: string
          mapped_data?: Json | null
          raw_data?: Json
          row_number?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_rows_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "import_files"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_chunks: {
        Row: {
          content: string
          created_at: string
          embedding: string | null
          id: string
          metadata: Json | null
          source_id: string | null
          source_type: string
          title: string | null
        }
        Insert: {
          content: string
          created_at?: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          source_id?: string | null
          source_type: string
          title?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          source_id?: string | null
          source_type?: string
          title?: string | null
        }
        Relationships: []
      }
      leads: {
        Row: {
          converted_opportunity_id: string | null
          created_at: string
          created_by: string | null
          duplicate_of: string | null
          estimated_value: number | null
          id: string
          lead_score: number | null
          lead_stage: Database["public"]["Enums"]["lead_stage"]
          location: string | null
          main_contractor_guess: string | null
          owner_id: string | null
          project_name: string
          project_stage_estimate:
            | Database["public"]["Enums"]["project_stage"]
            | null
          rejection_reason: string | null
          research_notes: string | null
          signage_potential:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          source: string
          source_url: string | null
          updated_at: string
        }
        Insert: {
          converted_opportunity_id?: string | null
          created_at?: string
          created_by?: string | null
          duplicate_of?: string | null
          estimated_value?: number | null
          id?: string
          lead_score?: number | null
          lead_stage?: Database["public"]["Enums"]["lead_stage"]
          location?: string | null
          main_contractor_guess?: string | null
          owner_id?: string | null
          project_name: string
          project_stage_estimate?:
            | Database["public"]["Enums"]["project_stage"]
            | null
          rejection_reason?: string | null
          research_notes?: string | null
          signage_potential?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          source?: string
          source_url?: string | null
          updated_at?: string
        }
        Update: {
          converted_opportunity_id?: string | null
          created_at?: string
          created_by?: string | null
          duplicate_of?: string | null
          estimated_value?: number | null
          id?: string
          lead_score?: number | null
          lead_stage?: Database["public"]["Enums"]["lead_stage"]
          location?: string | null
          main_contractor_guess?: string | null
          owner_id?: string | null
          project_name?: string
          project_stage_estimate?:
            | Database["public"]["Enums"]["project_stage"]
            | null
          rejection_reason?: string | null
          research_notes?: string | null
          signage_potential?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          source?: string
          source_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_converted_opportunity_id_fkey"
            columns: ["converted_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      operations_handovers: {
        Row: {
          approved_value: number | null
          commercial_owner_id: string | null
          contract_document_url: string | null
          created_at: string
          created_by: string | null
          handover_checklist_status: string
          handover_date: string | null
          id: string
          operations_owner_id: string | null
          opportunity_id: string
          updated_at: string
        }
        Insert: {
          approved_value?: number | null
          commercial_owner_id?: string | null
          contract_document_url?: string | null
          created_at?: string
          created_by?: string | null
          handover_checklist_status?: string
          handover_date?: string | null
          id?: string
          operations_owner_id?: string | null
          opportunity_id: string
          updated_at?: string
        }
        Update: {
          approved_value?: number | null
          commercial_owner_id?: string | null
          contract_document_url?: string | null
          created_at?: string
          created_by?: string | null
          handover_checklist_status?: string
          handover_date?: string | null
          id?: string
          operations_owner_id?: string | null
          opportunity_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operations_handovers_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          action_priority: Database["public"]["Enums"]["priority_tier"] | null
          action_required: boolean
          agent_reasoning: string | null
          agent_recommendation:
            | Database["public"]["Enums"]["approval_recommendation"]
            | null
          client: string | null
          company_id: string | null
          contract_received_date: string | null
          contract_reference_number: string | null
          contract_value: number | null
          contractor_decision_maker: string | null
          created_at: string
          created_by: string | null
          currency: string
          estimated_value_max: number | null
          estimated_value_min: number | null
          evidence_count: number
          exclusion_reason:
            | Database["public"]["Enums"]["exclusion_reason"]
            | null
          expected_contract_date: string | null
          flow_type: Database["public"]["Enums"]["flow_type"]
          handover_status: Database["public"]["Enums"]["handover_status"] | null
          hold_reason: string | null
          hold_review_date: string | null
          id: string
          last_activity_at: string | null
          location: string | null
          loss_notes: string | null
          loss_reason: string | null
          main_contractor: string | null
          main_contractor_confirmed: boolean
          main_contractor_id: string | null
          management_review_reason: string | null
          next_action: string | null
          next_action_due: string | null
          owner_id: string | null
          package_budget_confirmed: boolean
          pipeline_step: Database["public"]["Enums"]["pipeline_step"] | null
          prequalification_status: string | null
          project_id: string | null
          project_name: string
          project_stage: Database["public"]["Enums"]["project_stage"]
          quotation_value: number | null
          sales_stage: Database["public"]["Enums"]["sales_stage"] | null
          sector: string | null
          signage_package_confidence: Database["public"]["Enums"]["confidence_level"]
          signage_package_status: Database["public"]["Enums"]["signage_package_status"]
          source_confidence: Database["public"]["Enums"]["confidence_level"]
          stage: Database["public"]["Enums"]["opportunity_stage"]
          strategic_value: string | null
          tier: Database["public"]["Enums"]["priority_tier"]
          updated_at: string
          verbal_award_contact_name: string | null
          verbal_award_contact_title: string | null
          verbal_award_date: string | null
          verbal_award_evidence: string | null
          verbal_award_method: string | null
          win_confidence: Database["public"]["Enums"]["win_confidence"] | null
        }
        Insert: {
          action_priority?: Database["public"]["Enums"]["priority_tier"] | null
          action_required?: boolean
          agent_reasoning?: string | null
          agent_recommendation?:
            | Database["public"]["Enums"]["approval_recommendation"]
            | null
          client?: string | null
          company_id?: string | null
          contract_received_date?: string | null
          contract_reference_number?: string | null
          contract_value?: number | null
          contractor_decision_maker?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          estimated_value_max?: number | null
          estimated_value_min?: number | null
          evidence_count?: number
          exclusion_reason?:
            | Database["public"]["Enums"]["exclusion_reason"]
            | null
          expected_contract_date?: string | null
          flow_type?: Database["public"]["Enums"]["flow_type"]
          handover_status?:
            | Database["public"]["Enums"]["handover_status"]
            | null
          hold_reason?: string | null
          hold_review_date?: string | null
          id?: string
          last_activity_at?: string | null
          location?: string | null
          loss_notes?: string | null
          loss_reason?: string | null
          main_contractor?: string | null
          main_contractor_confirmed?: boolean
          main_contractor_id?: string | null
          management_review_reason?: string | null
          next_action?: string | null
          next_action_due?: string | null
          owner_id?: string | null
          package_budget_confirmed?: boolean
          pipeline_step?: Database["public"]["Enums"]["pipeline_step"] | null
          prequalification_status?: string | null
          project_id?: string | null
          project_name: string
          project_stage?: Database["public"]["Enums"]["project_stage"]
          quotation_value?: number | null
          sales_stage?: Database["public"]["Enums"]["sales_stage"] | null
          sector?: string | null
          signage_package_confidence?: Database["public"]["Enums"]["confidence_level"]
          signage_package_status?: Database["public"]["Enums"]["signage_package_status"]
          source_confidence?: Database["public"]["Enums"]["confidence_level"]
          stage?: Database["public"]["Enums"]["opportunity_stage"]
          strategic_value?: string | null
          tier?: Database["public"]["Enums"]["priority_tier"]
          updated_at?: string
          verbal_award_contact_name?: string | null
          verbal_award_contact_title?: string | null
          verbal_award_date?: string | null
          verbal_award_evidence?: string | null
          verbal_award_method?: string | null
          win_confidence?: Database["public"]["Enums"]["win_confidence"] | null
        }
        Update: {
          action_priority?: Database["public"]["Enums"]["priority_tier"] | null
          action_required?: boolean
          agent_reasoning?: string | null
          agent_recommendation?:
            | Database["public"]["Enums"]["approval_recommendation"]
            | null
          client?: string | null
          company_id?: string | null
          contract_received_date?: string | null
          contract_reference_number?: string | null
          contract_value?: number | null
          contractor_decision_maker?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          estimated_value_max?: number | null
          estimated_value_min?: number | null
          evidence_count?: number
          exclusion_reason?:
            | Database["public"]["Enums"]["exclusion_reason"]
            | null
          expected_contract_date?: string | null
          flow_type?: Database["public"]["Enums"]["flow_type"]
          handover_status?:
            | Database["public"]["Enums"]["handover_status"]
            | null
          hold_reason?: string | null
          hold_review_date?: string | null
          id?: string
          last_activity_at?: string | null
          location?: string | null
          loss_notes?: string | null
          loss_reason?: string | null
          main_contractor?: string | null
          main_contractor_confirmed?: boolean
          main_contractor_id?: string | null
          management_review_reason?: string | null
          next_action?: string | null
          next_action_due?: string | null
          owner_id?: string | null
          package_budget_confirmed?: boolean
          pipeline_step?: Database["public"]["Enums"]["pipeline_step"] | null
          prequalification_status?: string | null
          project_id?: string | null
          project_name?: string
          project_stage?: Database["public"]["Enums"]["project_stage"]
          quotation_value?: number | null
          sales_stage?: Database["public"]["Enums"]["sales_stage"] | null
          sector?: string | null
          signage_package_confidence?: Database["public"]["Enums"]["confidence_level"]
          signage_package_status?: Database["public"]["Enums"]["signage_package_status"]
          source_confidence?: Database["public"]["Enums"]["confidence_level"]
          stage?: Database["public"]["Enums"]["opportunity_stage"]
          strategic_value?: string | null
          tier?: Database["public"]["Enums"]["priority_tier"]
          updated_at?: string
          verbal_award_contact_name?: string | null
          verbal_award_contact_title?: string | null
          verbal_award_date?: string | null
          verbal_award_evidence?: string | null
          verbal_award_method?: string | null
          win_confidence?: Database["public"]["Enums"]["win_confidence"] | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_main_contractor_id_fkey"
            columns: ["main_contractor_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_flags: {
        Row: {
          action_owner_id: string | null
          action_type: Database["public"]["Enums"]["action_type"] | null
          created_at: string
          created_by: string | null
          due_date: string | null
          flag_kind: Database["public"]["Enums"]["flag_kind"]
          id: string
          linked_record_id: string
          linked_record_type: string
          priority: Database["public"]["Enums"]["priority_tier"] | null
          reason: string | null
          risk_flag: Database["public"]["Enums"]["risk_flag"] | null
          status: Database["public"]["Enums"]["flag_status"]
          updated_at: string
        }
        Insert: {
          action_owner_id?: string | null
          action_type?: Database["public"]["Enums"]["action_type"] | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          flag_kind: Database["public"]["Enums"]["flag_kind"]
          id?: string
          linked_record_id: string
          linked_record_type: string
          priority?: Database["public"]["Enums"]["priority_tier"] | null
          reason?: string | null
          risk_flag?: Database["public"]["Enums"]["risk_flag"] | null
          status?: Database["public"]["Enums"]["flag_status"]
          updated_at?: string
        }
        Update: {
          action_owner_id?: string | null
          action_type?: Database["public"]["Enums"]["action_type"] | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          flag_kind?: Database["public"]["Enums"]["flag_kind"]
          id?: string
          linked_record_id?: string
          linked_record_type?: string
          priority?: Database["public"]["Enums"]["priority_tier"] | null
          reason?: string | null
          risk_flag?: Database["public"]["Enums"]["risk_flag"] | null
          status?: Database["public"]["Enums"]["flag_status"]
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          language: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          language?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          language?: string
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          completion_pct: number | null
          consultant_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          expected_boq_date: string | null
          expected_signage_date: string | null
          id: string
          location: string | null
          main_contractor_id: string | null
          name: string
          notes: string | null
          owner_company_id: string | null
          project_stage: Database["public"]["Enums"]["project_stage"]
          sector: string | null
          signage_package_status: Database["public"]["Enums"]["signage_package_status"]
          source: string | null
          source_confidence: Database["public"]["Enums"]["confidence_level"]
          total_value: number | null
          updated_at: string
          verification_status: Database["public"]["Enums"]["verification_status"]
        }
        Insert: {
          completion_pct?: number | null
          consultant_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          expected_boq_date?: string | null
          expected_signage_date?: string | null
          id?: string
          location?: string | null
          main_contractor_id?: string | null
          name: string
          notes?: string | null
          owner_company_id?: string | null
          project_stage?: Database["public"]["Enums"]["project_stage"]
          sector?: string | null
          signage_package_status?: Database["public"]["Enums"]["signage_package_status"]
          source?: string | null
          source_confidence?: Database["public"]["Enums"]["confidence_level"]
          total_value?: number | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["verification_status"]
        }
        Update: {
          completion_pct?: number | null
          consultant_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          expected_boq_date?: string | null
          expected_signage_date?: string | null
          id?: string
          location?: string | null
          main_contractor_id?: string | null
          name?: string
          notes?: string | null
          owner_company_id?: string | null
          project_stage?: Database["public"]["Enums"]["project_stage"]
          sector?: string | null
          signage_package_status?: Database["public"]["Enums"]["signage_package_status"]
          source?: string | null
          source_confidence?: Database["public"]["Enums"]["confidence_level"]
          total_value?: number | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["verification_status"]
        }
        Relationships: [
          {
            foreignKeyName: "projects_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_main_contractor_id_fkey"
            columns: ["main_contractor_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_owner_company_id_fkey"
            columns: ["owner_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      quotations: {
        Row: {
          boq_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          id: string
          issued_date: string | null
          last_follow_up_at: string | null
          notes: string | null
          owner_id: string | null
          pdf_url: string | null
          quote_number: string
          related_opportunity_id: string
          status: Database["public"]["Enums"]["quotation_status"]
          updated_at: string
          valid_until: string | null
          value: number | null
          version: number
          win_loss_reason: string | null
        }
        Insert: {
          boq_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          issued_date?: string | null
          last_follow_up_at?: string | null
          notes?: string | null
          owner_id?: string | null
          pdf_url?: string | null
          quote_number: string
          related_opportunity_id: string
          status?: Database["public"]["Enums"]["quotation_status"]
          updated_at?: string
          valid_until?: string | null
          value?: number | null
          version?: number
          win_loss_reason?: string | null
        }
        Update: {
          boq_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          issued_date?: string | null
          last_follow_up_at?: string | null
          notes?: string | null
          owner_id?: string | null
          pdf_url?: string | null
          quote_number?: string
          related_opportunity_id?: string
          status?: Database["public"]["Enums"]["quotation_status"]
          updated_at?: string
          valid_until?: string | null
          value?: number | null
          version?: number
          win_loss_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotations_boq_id_fkey"
            columns: ["boq_id"]
            isOneToOne: false
            referencedRelation: "boqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendations: {
        Row: {
          agent_module: string
          confidence_score: number | null
          created_at: string
          created_by: string | null
          data_sources: string | null
          evidence: string | null
          id: string
          reason: string | null
          recommendation: string
          related_company_id: string | null
          related_lead_id: string | null
          related_opportunity_id: string | null
          required_approval_type: string | null
          risk_notes: string | null
          status: Database["public"]["Enums"]["recommendation_status"]
          suggested_owner_id: string | null
          updated_at: string
        }
        Insert: {
          agent_module: string
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          data_sources?: string | null
          evidence?: string | null
          id?: string
          reason?: string | null
          recommendation: string
          related_company_id?: string | null
          related_lead_id?: string | null
          related_opportunity_id?: string | null
          required_approval_type?: string | null
          risk_notes?: string | null
          status?: Database["public"]["Enums"]["recommendation_status"]
          suggested_owner_id?: string | null
          updated_at?: string
        }
        Update: {
          agent_module?: string
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          data_sources?: string | null
          evidence?: string | null
          id?: string
          reason?: string | null
          recommendation?: string
          related_company_id?: string | null
          related_lead_id?: string | null
          related_opportunity_id?: string | null
          required_approval_type?: string | null
          risk_notes?: string | null
          status?: Database["public"]["Enums"]["recommendation_status"]
          suggested_owner_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recommendations_related_company_id_fkey"
            columns: ["related_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendations_related_lead_id_fkey"
            columns: ["related_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendations_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      reference_projects: {
        Row: {
          challenges: string | null
          city: string | null
          client_or_contractor: string | null
          created_at: string
          created_by: string | null
          currency: string
          id: string
          images: string | null
          materials: string | null
          name: string
          phc_scope: string | null
          project_type: string | null
          project_value: number | null
          requires_approval_to_share: boolean
          sector: string | null
          shareable_with_client: boolean
          sign_types: string | null
          solutions: string | null
          updated_at: string
          year: number | null
        }
        Insert: {
          challenges?: string | null
          city?: string | null
          client_or_contractor?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          images?: string | null
          materials?: string | null
          name: string
          phc_scope?: string | null
          project_type?: string | null
          project_value?: number | null
          requires_approval_to_share?: boolean
          sector?: string | null
          shareable_with_client?: boolean
          sign_types?: string | null
          solutions?: string | null
          updated_at?: string
          year?: number | null
        }
        Update: {
          challenges?: string | null
          city?: string | null
          client_or_contractor?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          images?: string | null
          materials?: string | null
          name?: string
          phc_scope?: string | null
          project_type?: string | null
          project_value?: number | null
          requires_approval_to_share?: boolean
          sector?: string | null
          shareable_with_client?: boolean
          sign_types?: string | null
          solutions?: string | null
          updated_at?: string
          year?: number | null
        }
        Relationships: []
      }
      rfqs: {
        Row: {
          company_id: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          document_url: string | null
          estimated_value: number | null
          id: string
          notes: string | null
          opportunity_id: string | null
          project_id: string | null
          received_date: string
          response_due_date: string | null
          rfq_number: string | null
          sales_owner_id: string | null
          source_type: string | null
          status: Database["public"]["Enums"]["rfq_status"]
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          document_url?: string | null
          estimated_value?: number | null
          id?: string
          notes?: string | null
          opportunity_id?: string | null
          project_id?: string | null
          received_date?: string
          response_due_date?: string | null
          rfq_number?: string | null
          sales_owner_id?: string | null
          source_type?: string | null
          status?: Database["public"]["Enums"]["rfq_status"]
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          document_url?: string | null
          estimated_value?: number | null
          id?: string
          notes?: string | null
          opportunity_id?: string | null
          project_id?: string | null
          received_date?: string
          response_due_date?: string | null
          rfq_number?: string | null
          sales_owner_id?: string | null
          source_type?: string | null
          status?: Database["public"]["Enums"]["rfq_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfqs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfqs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfqs_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfqs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_targets: {
        Row: {
          activity_target: number
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          period_start: string
          period_type: Database["public"]["Enums"]["target_period"]
          pipeline_target: number
          quotation_target: number
          reactivation_target: number
          sales_target: number
          updated_at: string
          user_id: string
        }
        Insert: {
          activity_target?: number
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          period_start: string
          period_type?: Database["public"]["Enums"]["target_period"]
          pipeline_target?: number
          quotation_target?: number
          reactivation_target?: number
          sales_target?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          activity_target?: number
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          period_start?: string
          period_type?: Database["public"]["Enums"]["target_period"]
          pipeline_target?: number
          quotation_target?: number
          reactivation_target?: number
          sales_target?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      snapshot_versions: {
        Row: {
          agent_name: string
          generated_at: string
          id: string
          records_summary: Json | null
          snapshot_path: string | null
          status: string
          trigger_type: string | null
        }
        Insert: {
          agent_name: string
          generated_at?: string
          id?: string
          records_summary?: Json | null
          snapshot_path?: string | null
          status?: string
          trigger_type?: string | null
        }
        Update: {
          agent_name?: string
          generated_at?: string
          id?: string
          records_summary?: Json | null
          snapshot_path?: string | null
          status?: string
          trigger_type?: string | null
        }
        Relationships: []
      }
      source_registry: {
        Row: {
          approved_for_agent_use: boolean
          freshness_status: string | null
          id: string
          last_reviewed_at: string | null
          owner: string | null
          source_type: string
          vault_path: string
        }
        Insert: {
          approved_for_agent_use?: boolean
          freshness_status?: string | null
          id?: string
          last_reviewed_at?: string | null
          owner?: string | null
          source_type: string
          vault_path: string
        }
        Update: {
          approved_for_agent_use?: boolean
          freshness_status?: string | null
          id?: string
          last_reviewed_at?: string | null
          owner?: string | null
          source_type?: string
          vault_path?: string
        }
        Relationships: []
      }
      stage_transition_history: {
        Row: {
          actor_id: string | null
          approval_id: string | null
          created_at: string
          evidence: string | null
          from_stage: string | null
          id: string
          notes: string | null
          record_id: string
          record_type: string
          to_stage: string
        }
        Insert: {
          actor_id?: string | null
          approval_id?: string | null
          created_at?: string
          evidence?: string | null
          from_stage?: string | null
          id?: string
          notes?: string | null
          record_id: string
          record_type: string
          to_stage: string
        }
        Update: {
          actor_id?: string | null
          approval_id?: string | null
          created_at?: string
          evidence?: string | null
          from_stage?: string | null
          id?: string
          notes?: string | null
          record_id?: string
          record_type?: string
          to_stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "stage_transition_history_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id"]
          },
        ]
      }
      stakeholders: {
        Row: {
          contact_confidence: Database["public"]["Enums"]["confidence_level"]
          contact_order: number | null
          created_at: string
          email: string | null
          id: string
          last_interaction_at: string | null
          name: string
          notes: string | null
          opportunity_id: string
          organization: string | null
          phone: string | null
          role: string | null
          updated_at: string
        }
        Insert: {
          contact_confidence?: Database["public"]["Enums"]["confidence_level"]
          contact_order?: number | null
          created_at?: string
          email?: string | null
          id?: string
          last_interaction_at?: string | null
          name: string
          notes?: string | null
          opportunity_id: string
          organization?: string | null
          phone?: string | null
          role?: string | null
          updated_at?: string
        }
        Update: {
          contact_confidence?: Database["public"]["Enums"]["confidence_level"]
          contact_order?: number | null
          created_at?: string
          email?: string | null
          id?: string
          last_interaction_at?: string | null
          name?: string
          notes?: string | null
          opportunity_id?: string
          organization?: string | null
          phone?: string | null
          role?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stakeholders_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          due_date: string | null
          id: string
          owner_id: string | null
          priority: Database["public"]["Enums"]["priority_tier"]
          related_opportunity_id: string | null
          source: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          owner_id?: string | null
          priority?: Database["public"]["Enums"]["priority_tier"]
          related_opportunity_id?: string | null
          source?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          owner_id?: string | null
          priority?: Database["public"]["Enums"]["priority_tier"]
          related_opportunity_id?: string | null
          source?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_contractors: {
        Row: {
          contractor_company_id: string | null
          contractor_status: string | null
          created_at: string
          created_by: string | null
          id: string
          last_verified_at: string | null
          notes: string | null
          source: string | null
          tender_id: string
          win_likelihood: Database["public"]["Enums"]["confidence_level"] | null
        }
        Insert: {
          contractor_company_id?: string | null
          contractor_status?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_verified_at?: string | null
          notes?: string | null
          source?: string | null
          tender_id: string
          win_likelihood?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
        }
        Update: {
          contractor_company_id?: string | null
          contractor_status?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_verified_at?: string | null
          notes?: string | null
          source?: string | null
          tender_id?: string
          win_likelihood?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "tender_contractors_contractor_company_id_fkey"
            columns: ["contractor_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_contractors_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      tenders: {
        Row: {
          archive_reason: string | null
          award_evidence: string | null
          converted_opportunity_id: string | null
          created_at: string
          created_by: string | null
          estimated_project_value: number | null
          expected_award_date: string | null
          id: string
          main_contractor_id: string | null
          next_follow_up_date: string | null
          project_id: string | null
          signage_potential:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          source: string | null
          tender_name: string
          tender_owner_id: string | null
          tender_priority_classification:
            | Database["public"]["Enums"]["priority_tier"]
            | null
          tender_stage: Database["public"]["Enums"]["tender_stage"]
          updated_at: string
        }
        Insert: {
          archive_reason?: string | null
          award_evidence?: string | null
          converted_opportunity_id?: string | null
          created_at?: string
          created_by?: string | null
          estimated_project_value?: number | null
          expected_award_date?: string | null
          id?: string
          main_contractor_id?: string | null
          next_follow_up_date?: string | null
          project_id?: string | null
          signage_potential?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          source?: string | null
          tender_name: string
          tender_owner_id?: string | null
          tender_priority_classification?:
            | Database["public"]["Enums"]["priority_tier"]
            | null
          tender_stage?: Database["public"]["Enums"]["tender_stage"]
          updated_at?: string
        }
        Update: {
          archive_reason?: string | null
          award_evidence?: string | null
          converted_opportunity_id?: string | null
          created_at?: string
          created_by?: string | null
          estimated_project_value?: number | null
          expected_award_date?: string | null
          id?: string
          main_contractor_id?: string | null
          next_follow_up_date?: string | null
          project_id?: string | null
          signage_potential?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          source?: string | null
          tender_name?: string
          tender_owner_id?: string | null
          tender_priority_classification?:
            | Database["public"]["Enums"]["priority_tier"]
            | null
          tender_stage?: Database["public"]["Enums"]["tender_stage"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenders_converted_opportunity_id_fkey"
            columns: ["converted_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenders_main_contractor_id_fkey"
            columns: ["main_contractor_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
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
      vendors: {
        Row: {
          city: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          id: string
          internal_notes: string | null
          internal_rating: number | null
          lead_time: string | null
          materials: string | null
          name: string
          portal_url: string | null
          previous_projects: string | null
          qualification_files: string | null
          quality_level: string | null
          reference_prices: string | null
          scope: string | null
          updated_at: string
        }
        Insert: {
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          internal_notes?: string | null
          internal_rating?: number | null
          lead_time?: string | null
          materials?: string | null
          name: string
          portal_url?: string | null
          previous_projects?: string | null
          qualification_files?: string | null
          quality_level?: string | null
          reference_prices?: string | null
          scope?: string | null
          updated_at?: string
        }
        Update: {
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          internal_notes?: string | null
          internal_rating?: number | null
          lead_time?: string | null
          materials?: string | null
          name?: string
          portal_url?: string | null
          previous_projects?: string | null
          qualification_files?: string | null
          quality_level?: string | null
          reference_prices?: string | null
          scope?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      vendors_public: {
        Row: {
          city: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string | null
          id: string | null
          lead_time: string | null
          materials: string | null
          name: string | null
          portal_url: string | null
          previous_projects: string | null
          quality_level: string | null
          scope: string | null
          updated_at: string | null
        }
        Insert: {
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          id?: string | null
          lead_time?: string | null
          materials?: string | null
          name?: string | null
          portal_url?: string | null
          previous_projects?: string | null
          quality_level?: string | null
          scope?: string | null
          updated_at?: string | null
        }
        Update: {
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          id?: string | null
          lead_time?: string | null
          materials?: string | null
          name?: string | null
          portal_url?: string | null
          previous_projects?: string | null
          quality_level?: string | null
          scope?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      match_knowledge: {
        Args: {
          filter_source_type?: string
          match_count?: number
          query_embedding: string
        }
        Returns: {
          content: string
          id: string
          similarity: number
          source_id: string
          source_type: string
          title: string
        }[]
      }
    }
    Enums: {
      account_status: "pending_review" | "active" | "dormant" | "do_not_target"
      action_type:
        | "request_boq"
        | "request_scope_clarification"
        | "follow_up_required"
        | "site_visit_required"
        | "price_approval_required"
        | "discount_approval_required"
        | "technical_review_required"
        | "vendor_quotation_required"
        | "contract_review_required"
        | "contact_verification_required"
        | "tender_decision_required"
        | "project_stage_verification_required"
        | "finance_or_risk_review_required"
      activity_status: "logged" | "draft" | "sent"
      activity_type:
        | "call"
        | "visit"
        | "meeting"
        | "email_draft"
        | "whatsapp_draft"
        | "note"
      agent_run_status:
        | "running"
        | "completed"
        | "needs_review"
        | "paused"
        | "error"
      app_role:
        | "ceo"
        | "sales_manager"
        | "bd_manager"
        | "viewer"
        | "salesperson"
        | "system_admin"
        | "managing_director"
        | "general_manager"
      approval_recommendation: "proceed" | "management_review" | "do_not_quote"
      approval_status: "pending" | "approved" | "returned" | "escalated"
      artifact_status: "draft" | "awaiting_review" | "approved" | "rejected"
      artifact_type:
        | "stakeholder_map"
        | "pricing_brief"
        | "outreach_draft"
        | "qualification_brief"
        | "discovery_research_brief"
      boq_status:
        | "verified"
        | "partially_verified"
        | "estimated_scope"
        | "missing"
      company_type:
        | "main_contractor"
        | "developer"
        | "owner"
        | "consultant"
        | "existing_client"
        | "previous_client"
        | "target_account"
        | "vendor"
        | "do_not_target"
      confidence_level: "high" | "medium" | "low"
      contact_authority:
        | "decision_maker"
        | "influencer"
        | "technical_contact"
        | "unknown_authority"
      contact_location: "site_office" | "head_office" | "unknown"
      exclusion_reason:
        | "no_signage_package"
        | "low_commercial_value"
        | "no_clear_contractor"
        | "outside_phc_scope"
        | "duplicate_opportunity"
        | "insufficient_evidence"
        | "other"
      flag_kind: "action_required" | "risk"
      flag_status: "open" | "resolved"
      flow_type: "direct_rfq" | "tender_converted" | "manual"
      follow_up_status:
        | "scheduled"
        | "due"
        | "overdue"
        | "completed"
        | "cancelled"
      handover_status: "pending" | "ready" | "handed_over"
      lead_stage:
        | "detected"
        | "duplicate_check"
        | "research"
        | "contractor_identification"
        | "project_stage_check"
        | "signage_assessment"
        | "value_estimate"
        | "scored"
        | "human_review"
        | "converted"
        | "rejected"
      opportunity_stage:
        | "discovery"
        | "qualification"
        | "preparation"
        | "quotation"
        | "follow_up"
        | "won"
        | "lost"
        | "archived"
      pipeline_step:
        | "new_project_detected"
        | "researching"
        | "needs_verification"
        | "qualified_lead"
        | "assigned"
        | "outreach_awaiting_approval"
        | "first_contact"
        | "discovery_site_validation"
        | "boq_requested"
        | "boq_received"
        | "boq_verified"
        | "proposal_preparation"
        | "proposal_submitted"
        | "negotiation"
        | "contract_review"
        | "won"
        | "lost"
        | "hold"
      priority_tier: "A" | "B" | "C"
      project_stage:
        | "early_planning"
        | "design_development"
        | "tender"
        | "awarded"
        | "under_construction"
        | "near_handover"
        | "completed"
        | "unknown"
      quotation_status:
        | "draft"
        | "under_internal_review"
        | "approved_for_submission"
        | "submitted"
        | "follow_up"
        | "negotiation"
        | "revised"
        | "won"
        | "lost"
        | "expired"
      recommendation_status: "pending" | "accepted" | "dismissed" | "actioned"
      rfq_status: "open" | "converted" | "lost" | "on_hold"
      risk_flag:
        | "boq_missing"
        | "source_unverified"
        | "contact_not_confirmed"
        | "project_stage_unverified"
        | "package_may_be_closed"
        | "payment_risk"
        | "margin_risk"
        | "follow_up_overdue"
        | "contract_pending"
        | "approval_pending"
      sales_stage:
        | "rfq_received"
        | "jih"
        | "under_negotiation"
        | "verbally_awarded"
        | "contract_received"
        | "won"
        | "lost"
        | "on_hold"
      signage_package_status:
        | "confirmed"
        | "likely"
        | "unknown"
        | "not_applicable"
        | "no_package_identified"
      target_period: "monthly" | "quarterly"
      tender_stage:
        | "tender_identified"
        | "tender_under_process"
        | "award_negotiation"
        | "awarded_to_contractor"
        | "converted_to_jih"
        | "tender_lost_or_archived"
      verification_status: "pending_verification" | "verified" | "rejected"
      win_confidence: "low" | "possible" | "strong" | "sure_win"
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
      account_status: ["pending_review", "active", "dormant", "do_not_target"],
      action_type: [
        "request_boq",
        "request_scope_clarification",
        "follow_up_required",
        "site_visit_required",
        "price_approval_required",
        "discount_approval_required",
        "technical_review_required",
        "vendor_quotation_required",
        "contract_review_required",
        "contact_verification_required",
        "tender_decision_required",
        "project_stage_verification_required",
        "finance_or_risk_review_required",
      ],
      activity_status: ["logged", "draft", "sent"],
      activity_type: [
        "call",
        "visit",
        "meeting",
        "email_draft",
        "whatsapp_draft",
        "note",
      ],
      agent_run_status: [
        "running",
        "completed",
        "needs_review",
        "paused",
        "error",
      ],
      app_role: [
        "ceo",
        "sales_manager",
        "bd_manager",
        "viewer",
        "salesperson",
        "system_admin",
        "managing_director",
        "general_manager",
      ],
      approval_recommendation: ["proceed", "management_review", "do_not_quote"],
      approval_status: ["pending", "approved", "returned", "escalated"],
      artifact_status: ["draft", "awaiting_review", "approved", "rejected"],
      artifact_type: [
        "stakeholder_map",
        "pricing_brief",
        "outreach_draft",
        "qualification_brief",
        "discovery_research_brief",
      ],
      boq_status: [
        "verified",
        "partially_verified",
        "estimated_scope",
        "missing",
      ],
      company_type: [
        "main_contractor",
        "developer",
        "owner",
        "consultant",
        "existing_client",
        "previous_client",
        "target_account",
        "vendor",
        "do_not_target",
      ],
      confidence_level: ["high", "medium", "low"],
      contact_authority: [
        "decision_maker",
        "influencer",
        "technical_contact",
        "unknown_authority",
      ],
      contact_location: ["site_office", "head_office", "unknown"],
      exclusion_reason: [
        "no_signage_package",
        "low_commercial_value",
        "no_clear_contractor",
        "outside_phc_scope",
        "duplicate_opportunity",
        "insufficient_evidence",
        "other",
      ],
      flag_kind: ["action_required", "risk"],
      flag_status: ["open", "resolved"],
      flow_type: ["direct_rfq", "tender_converted", "manual"],
      follow_up_status: [
        "scheduled",
        "due",
        "overdue",
        "completed",
        "cancelled",
      ],
      handover_status: ["pending", "ready", "handed_over"],
      lead_stage: [
        "detected",
        "duplicate_check",
        "research",
        "contractor_identification",
        "project_stage_check",
        "signage_assessment",
        "value_estimate",
        "scored",
        "human_review",
        "converted",
        "rejected",
      ],
      opportunity_stage: [
        "discovery",
        "qualification",
        "preparation",
        "quotation",
        "follow_up",
        "won",
        "lost",
        "archived",
      ],
      pipeline_step: [
        "new_project_detected",
        "researching",
        "needs_verification",
        "qualified_lead",
        "assigned",
        "outreach_awaiting_approval",
        "first_contact",
        "discovery_site_validation",
        "boq_requested",
        "boq_received",
        "boq_verified",
        "proposal_preparation",
        "proposal_submitted",
        "negotiation",
        "contract_review",
        "won",
        "lost",
        "hold",
      ],
      priority_tier: ["A", "B", "C"],
      project_stage: [
        "early_planning",
        "design_development",
        "tender",
        "awarded",
        "under_construction",
        "near_handover",
        "completed",
        "unknown",
      ],
      quotation_status: [
        "draft",
        "under_internal_review",
        "approved_for_submission",
        "submitted",
        "follow_up",
        "negotiation",
        "revised",
        "won",
        "lost",
        "expired",
      ],
      recommendation_status: ["pending", "accepted", "dismissed", "actioned"],
      rfq_status: ["open", "converted", "lost", "on_hold"],
      risk_flag: [
        "boq_missing",
        "source_unverified",
        "contact_not_confirmed",
        "project_stage_unverified",
        "package_may_be_closed",
        "payment_risk",
        "margin_risk",
        "follow_up_overdue",
        "contract_pending",
        "approval_pending",
      ],
      sales_stage: [
        "rfq_received",
        "jih",
        "under_negotiation",
        "verbally_awarded",
        "contract_received",
        "won",
        "lost",
        "on_hold",
      ],
      signage_package_status: [
        "confirmed",
        "likely",
        "unknown",
        "not_applicable",
        "no_package_identified",
      ],
      target_period: ["monthly", "quarterly"],
      tender_stage: [
        "tender_identified",
        "tender_under_process",
        "award_negotiation",
        "awarded_to_contractor",
        "converted_to_jih",
        "tender_lost_or_archived",
      ],
      verification_status: ["pending_verification", "verified", "rejected"],
      win_confidence: ["low", "possible", "strong", "sure_win"],
    },
  },
} as const
