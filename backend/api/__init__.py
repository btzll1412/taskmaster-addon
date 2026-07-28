def register_blueprints(app):
    from .auth_routes import bp as auth_bp
    from .users import bp as users_bp
    from .boards import bp as boards_bp
    from .items import bp as items_bp
    from .misc import bp as misc_bp
    from .workspace import bp as workspace_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(users_bp)
    app.register_blueprint(boards_bp)
    app.register_blueprint(items_bp)
    app.register_blueprint(misc_bp)
    app.register_blueprint(workspace_bp)
