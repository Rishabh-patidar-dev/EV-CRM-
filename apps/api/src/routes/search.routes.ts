import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { SearchController } from "../controllers/search.controller.js";

const search = new SearchController();
const router = Router();
router.use(requireAuth);

router.get("/", search.search.bind(search));

export default router;
