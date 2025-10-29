import sqlite3

def migrate_database():
    conn = sqlite3.connect('taskmaster.db')
    cursor = conn.cursor()
    
    print("Starting email system migration...")
    
    try:
        # 1. Add email columns to users table
        print("Adding email column to users table...")
        cursor.execute("ALTER TABLE users ADD COLUMN email TEXT")
        cursor.execute("ALTER TABLE users ADD COLUMN email_notifications BOOLEAN DEFAULT 1")
        cursor.execute("ALTER TABLE users ADD COLUMN notify_on_assignment BOOLEAN DEFAULT 1")
        cursor.execute("ALTER TABLE users ADD COLUMN notify_on_status_change BOOLEAN DEFAULT 1")
        cursor.execute("ALTER TABLE users ADD COLUMN notify_on_comment BOOLEAN DEFAULT 1")
        cursor.execute("ALTER TABLE users ADD COLUMN notify_on_mention BOOLEAN DEFAULT 1")
        print("✓ Users table updated")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print("✓ Email columns already exist in users table")
        else:
            print(f"Error updating users table: {e}")
    
    try:
        # 2. Create system_settings table
        print("Creating system_settings table...")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS system_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                setting_key TEXT UNIQUE NOT NULL,
                setting_value TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Insert default settings
        settings = [
            ('system_url', 'http://localhost:5000'),
            ('smtp_server', ''),
            ('smtp_port', '587'),
            ('smtp_username', ''),
            ('smtp_password', ''),
            ('email_from', 'noreply@taskmaster.com')
        ]
        
        for key, value in settings:
            cursor.execute("""
                INSERT OR IGNORE INTO system_settings (setting_key, setting_value) 
                VALUES (?, ?)
            """, (key, value))
        
        print("✓ System settings table created")
    except Exception as e:
        print(f"Error creating system_settings table: {e}")
    
    try:
        # 3. Create notification_log table
        print("Creating notification_log table...")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS notification_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                notification_type TEXT NOT NULL,
                task_id INTEGER,
                message TEXT NOT NULL,
                sent_successfully BOOLEAN DEFAULT 0,
                error_message TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (task_id) REFERENCES tasks(id)
            )
        """)
        print("✓ Notification log table created")
    except Exception as e:
        print(f"Error creating notification_log table: {e}")
    
    conn.commit()
    conn.close()
    print("\n✅ Migration completed successfully!")

if __name__ == '__main__':
    migrate_database()
