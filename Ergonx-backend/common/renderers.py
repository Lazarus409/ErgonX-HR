from rest_framework.renderers import JSONRenderer


class EnvelopeJSONRenderer(JSONRenderer):
    def render(self, data, accepted_media_type=None, renderer_context=None):
        if data is None:
            payload = None
        elif isinstance(data, dict) and "success" in data:
            payload = data
        else:
            payload = {
                "success": True,
                "data": data,
                "message": "",
                "errors": None,
            }
        return super().render(payload, accepted_media_type, renderer_context)
