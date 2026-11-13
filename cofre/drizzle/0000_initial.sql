CREATE TABLE "auth_audit_logs" (
	"audit_id" serial PRIMARY KEY NOT NULL,
	"user_uid" text NOT NULL,
	"device_id" text NOT NULL,
	"event_type" text NOT NULL,
	"ip_hash_sha256" text NOT NULL,
	"metadata_json" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authorized_devices" (
	"device_id" text PRIMARY KEY NOT NULL,
	"user_uid" text NOT NULL,
	"device_name" text NOT NULL,
	"platform" text NOT NULL,
	"auth_method" text NOT NULL,
	"webauthn_credential_id" text,
	"public_key_spki_b64" text,
	"session_token_sha256" text NOT NULL,
	"csrf_token_sha256" text,
	"authorized_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "encrypted_record_history" (
	"history_id" serial PRIMARY KEY NOT NULL,
	"vault_id" text NOT NULL,
	"record_id" text NOT NULL,
	"record_type" text NOT NULL,
	"revision" integer NOT NULL,
	"key_epoch" integer NOT NULL,
	"deleted" boolean NOT NULL,
	"nonce_hex" text NOT NULL,
	"ciphertext_hex" text NOT NULL,
	"aad_hash_sha256_hex" text NOT NULL,
	"archived_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encrypted_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"vault_id" text NOT NULL,
	"record_id" text NOT NULL,
	"record_type" text NOT NULL,
	"format_version" integer DEFAULT 2 NOT NULL,
	"revision" integer NOT NULL,
	"key_epoch" integer DEFAULT 1 NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"nonce_hex" text NOT NULL,
	"ciphertext_hex" text NOT NULL,
	"aad_hash_sha256_hex" text NOT NULL,
	"server_cursor" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_operation_log" (
	"operation_id" text PRIMARY KEY NOT NULL,
	"vault_id" text NOT NULL,
	"user_uid" text NOT NULL,
	"record_id" text NOT NULL,
	"status" text NOT NULL,
	"server_revision" integer NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"uid" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vaults" (
	"vault_id" text PRIMARY KEY NOT NULL,
	"user_uid" text NOT NULL,
	"active_key_epoch" integer DEFAULT 1 NOT NULL,
	"kdf_params_json" text NOT NULL,
	"salt_hex" text NOT NULL,
	"wrapped_dek_hex" text NOT NULL,
	"dek_nonce_hex" text NOT NULL,
	"recovery_salt_hex" text,
	"recovery_wrapped_dek_hex" text,
	"recovery_dek_nonce_hex" text,
	"recovery_key_version" integer DEFAULT 0 NOT NULL,
	"recovery_key_commitment_sha256" text,
	"recovery_updated_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webauthn_challenges" (
	"challenge_id" text PRIMARY KEY NOT NULL,
	"user_uid" text NOT NULL,
	"challenge" text NOT NULL,
	"purpose" text NOT NULL,
	"rp_id" text NOT NULL,
	"expected_origin" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webauthn_credentials" (
	"credential_id" text PRIMARY KEY NOT NULL,
	"user_uid" text NOT NULL,
	"public_key_base64" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"device_type" text DEFAULT 'singleDevice' NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"transports_json" text DEFAULT '[]' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "authorized_devices" ADD CONSTRAINT "authorized_devices_user_uid_users_uid_fk" FOREIGN KEY ("user_uid") REFERENCES "public"."users"("uid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encrypted_record_history" ADD CONSTRAINT "encrypted_record_history_vault_id_vaults_vault_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("vault_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encrypted_records" ADD CONSTRAINT "encrypted_records_vault_id_vaults_vault_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("vault_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_operation_log" ADD CONSTRAINT "sync_operation_log_vault_id_vaults_vault_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("vault_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_operation_log" ADD CONSTRAINT "sync_operation_log_user_uid_users_uid_fk" FOREIGN KEY ("user_uid") REFERENCES "public"."users"("uid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaults" ADD CONSTRAINT "vaults_user_uid_users_uid_fk" FOREIGN KEY ("user_uid") REFERENCES "public"."users"("uid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_uid_users_uid_fk" FOREIGN KEY ("user_uid") REFERENCES "public"."users"("uid") ON DELETE no action ON UPDATE no action;