from app.core.cors import frontend_origins


def test_local_and_deployed_origins_are_always_allowed():
    origins = frontend_origins("")
    assert origins[:3] == [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://onepass-with-dongbakcoin-beta.vercel.app",
    ]


def test_render_backend_is_not_accepted_as_a_frontend_origin():
    origins = frontend_origins(
        "https://onepass-with-dongbakcoin.onrender.com,"
        "https://onepass-with-dongbakcoin.onrender.com/api/v1"
    )
    assert "https://onepass-with-dongbakcoin.onrender.com" not in origins
    assert all("onrender.com" not in origin for origin in origins)
    assert "http://localhost:3000" in origins
    assert "http://127.0.0.1:3000" in origins
    assert "https://onepass-with-dongbakcoin-beta.vercel.app" in origins


def test_extra_frontend_origin_is_kept():
    origins = frontend_origins("https://onepass-preview.vercel.app")
    assert "https://onepass-preview.vercel.app" in origins
