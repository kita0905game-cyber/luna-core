export default {
  fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "LUNA CORE",
        deployProbe: "2026-09-22-a",
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
