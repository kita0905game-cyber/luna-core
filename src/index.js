function json(data, init = {}) {
  return Response.json(data, init);
}

export default {
  fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "LUNA CORE",
        time: new Date().toISOString(),
      });
    }

    if (url.pathname === "/quest") {
      return json({
        ok: true,
        service: "LUNA CORE",
        module: "LIFE QUEST",
        status: "scaffold",
        message: "LIFE QUEST integration endpoint is ready for expansion.",
        time: new Date().toISOString(),
      });
    }

    return new Response("LUNA CORE is running");
  },

  scheduled(controller) {
    console.log(JSON.stringify({
      event: "LUNA_CORE_SCHEDULED",
      cron: controller.cron,
      scheduledTime: controller.scheduledTime,
    }));
  },
};
