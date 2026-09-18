import { checkHealth } from "../controllers/healthcontroller.js";

async function healthRoute(fastify,options){
    fastify.get("/health",checkHealth);

    fastify.get("/",async(req,res)=>{
        return res.code(200).send({message:"LabelLens API is running"});
    });
}

export default healthRoute;