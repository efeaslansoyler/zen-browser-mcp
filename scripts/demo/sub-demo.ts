import { subscribe } from "../../src/zen.ts";
subscribe((e) => console.log("EVENT", JSON.stringify(e)), { cwd: "/home/you/projects/my-shop" });
